"use server";

/**
 * actions.ts — Server Actions per le Classi.
 *
 * createClass: POST /api/classes
 *
 * updateClass e deleteClass sono gestiti via client fetch in ClassRow
 * ("use client") perché il componente è già client per l'interattività
 * della riga; una Server Action aggiuntiva non apporta valore e aggiunge
 * complessità. Stesso pattern di categories/actions.ts.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
// createClass
// ---------------------------------------------------------------------------

export async function createClass(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const category_id = (formData.get("category_id") as string | null) ?? "";
  const fund_id = (formData.get("fund_id") as string | null) ?? "";
  const tipologia = (formData.get("tipologia") as string | null) ?? "";
  const sort_order_raw = formData.get("sort_order") as string | null;

  if (!name) {
    return { status: "error", message: "Il nome è obbligatorio." };
  }
  if (!category_id) {
    return { status: "error", message: "Seleziona una categoria." };
  }
  if (!tipologia) {
    return { status: "error", message: "Seleziona una tipologia." };
  }

  const sort_order =
    sort_order_raw && sort_order_raw.trim() !== ""
      ? parseInt(sort_order_raw, 10)
      : 0;

  const body: Record<string, unknown> = {
    category_id,
    name,
    tipologia,
    sort_order,
  };

  let res: Response;
  try {
    const baseUrl = await buildBaseUrl();
    const cookieHeader = await getCookieHeader();
    res = await fetch(`${baseUrl}/api/classes`, {
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

  if (res.status === 409) {
    return {
      status: "error",
      message: "Esiste già una classe con questo nome in questa categoria.",
    };
  }

  if (res.status === 401) {
    return {
      status: "error",
      message: "Sessione scaduta. Accedi di nuovo per continuare.",
    };
  }

  if (res.status === 404) {
    return {
      status: "error",
      message: "Categoria non trovata. Seleziona una categoria valida.",
    };
  }

  if (!res.ok) {
    return {
      status: "error",
      message: "Si è verificato un errore. Riprova più tardi.",
    };
  }

  revalidatePath("/classes");
  const redirectUrl = fund_id
    ? `/classes?fund_id=${fund_id}&category_id=${category_id}`
    : `/classes?category_id=${category_id}`;
  redirect(redirectUrl);
}
