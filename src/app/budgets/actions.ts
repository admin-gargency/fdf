"use server";

/**
 * actions.ts — Server Actions per i Budget.
 *
 * createBudget: POST /api/budgets — crea/aggiorna un budget mensile.
 *
 * Le mutazioni inline (modifica importo, eliminazione) sono gestite via
 * client fetch in BudgetRow ("use client") — stesso pattern di TransactionRow.tsx.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

// ---------------------------------------------------------------------------
// Tipi condivisi
// ---------------------------------------------------------------------------

export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: string }
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
// createBudget — POST /api/budgets (upsert)
// ---------------------------------------------------------------------------

export async function createBudget(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const classId = (formData.get("class_id") as string | null)?.trim() ?? "";
  const period = (formData.get("period") as string | null)?.trim() ?? "";
  const amountRaw = (formData.get("amount") as string | null)?.trim() ?? "";

  // Validazione lato client ridondante (già in BudgetForm), ma per sicurezza
  if (!classId) {
    return { status: "error", message: "Seleziona una classe di spesa.", field: "class_id" };
  }
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return { status: "error", message: "Seleziona un mese valido.", field: "period" };
  }

  const amountEuro = parseFloat(amountRaw.replace(",", "."));
  if (isNaN(amountEuro) || amountEuro < 0) {
    return { status: "error", message: "Inserisci un importo valido (≥ 0).", field: "amount" };
  }

  const amount_cents = Math.round(amountEuro * 100);

  const baseUrl = await buildBaseUrl();
  const cookieHeader = await getCookieHeader();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/budgets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ class_id: classId, period, amount_cents }),
    });
  } catch {
    return { status: "error", message: "Errore di rete. Riprova più tardi." };
  }

  if (res.status === 401) {
    redirect("/login");
  }

  if (res.status === 400) {
    return {
      status: "error",
      message: "Dati non validi. Controlla i campi e riprova.",
      field: "amount",
    };
  }

  if (res.status === 404) {
    return {
      status: "error",
      message: "Classe non trovata. Seleziona una classe valida.",
      field: "class_id",
    };
  }

  if (!res.ok) {
    return { status: "error", message: "Si è verificato un errore. Riprova più tardi." };
  }

  // Redirect alla pagina budget con il mese selezionato per feedback visivo
  redirect(`/budgets?period=${period}`);
}
