"use server";

/**
 * actions.ts — Server Actions per le Transazioni.
 *
 * createFirstAccount: POST /api/accounts — crea il primo conto corrente.
 * createTransaction: POST /api/transactions — registra una transazione manuale.
 *
 * Le mutazioni inline (cambio classe, eliminazione) sono gestite via client
 * fetch in TransactionRow ("use client") — stesso pattern di ClassRow.tsx.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseEuroToCents } from "@/lib/domain/transactions";

// ---------------------------------------------------------------------------
// Tipi condivisi
// ---------------------------------------------------------------------------

export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

// ---------------------------------------------------------------------------
// Helper — costruisce l'URL base del server
// ---------------------------------------------------------------------------

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

async function getCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.toString();
}

// ---------------------------------------------------------------------------
// Mappa status HTTP → messaggio italiano
// ---------------------------------------------------------------------------

function mapStatusToError(status: number, context: "account" | "transaction"): string {
  switch (status) {
    case 401:
      return "Sessione scaduta. Accedi di nuovo per continuare.";
    case 403:
      return "Categoria non valida per il tuo nucleo.";
    case 404:
      return context === "account"
        ? "Conto non trovato. Seleziona un conto valido."
        : "Conto non trovato. Seleziona un conto valido.";
    case 409:
      return context === "account"
        ? "Esiste già un conto con questo nome."
        : "Si è verificato un errore. Riprova più tardi.";
    default:
      return "Si è verificato un errore. Riprova più tardi.";
  }
}

// ---------------------------------------------------------------------------
// createFirstAccount
// ---------------------------------------------------------------------------

export async function createFirstAccount(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const kind = (formData.get("kind") as string | null) ?? "corrente";

  if (!name) {
    return { status: "error", message: "Il nome del conto è obbligatorio." };
  }

  if (kind !== "corrente" && kind !== "fondi") {
    return { status: "error", message: "Tipo di conto non valido." };
  }

  let res: Response;
  try {
    const baseUrl = await buildBaseUrl();
    const cookieHeader = await getCookieHeader();
    res = await fetch(`${baseUrl}/api/accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ name, kind }),
      cache: "no-store",
    });
  } catch {
    return { status: "error", message: "Errore di rete. Riprova più tardi." };
  }

  if (!res.ok) {
    return { status: "error", message: mapStatusToError(res.status, "account") };
  }

  revalidatePath("/transactions/new");
  redirect("/transactions/new");
}

// ---------------------------------------------------------------------------
// createTransaction
// ---------------------------------------------------------------------------

export async function createTransaction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const account_id = (formData.get("account_id") as string | null) ?? "";
  const class_id_raw = (formData.get("class_id") as string | null) ?? "";
  const booked_at = (formData.get("booked_at") as string | null)?.trim() ?? "";
  const kind = (formData.get("kind") as string | null) ?? "spesa";
  const amount_raw = (formData.get("amount") as string | null) ?? "";
  const description = (formData.get("description") as string | null)?.trim() ?? "";

  if (!account_id) {
    return { status: "error", message: "Seleziona un conto." };
  }

  if (!booked_at) {
    return { status: "error", message: "La data è obbligatoria." };
  }

  const absCents = parseEuroToCents(amount_raw);
  if (absCents === null) {
    return { status: "error", message: "Importo non valido." };
  }

  const amount_cents = kind === "spesa" ? -absCents : absCents;

  const body: Record<string, unknown> = {
    account_id,
    booked_at,
    amount_cents,
  };

  // Ometti class_id se non selezionata
  if (class_id_raw.trim() !== "") {
    body.class_id = class_id_raw;
  }

  if (description.length > 0) {
    body.description = description;
  }

  let res: Response;
  try {
    const baseUrl = await buildBaseUrl();
    const cookieHeader = await getCookieHeader();
    res = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { status: "error", message: "Errore di rete. Riprova più tardi." };
  }

  if (!res.ok) {
    return {
      status: "error",
      message: mapStatusToError(res.status, "transaction"),
    };
  }

  revalidatePath("/transactions");
  redirect("/transactions");
}
