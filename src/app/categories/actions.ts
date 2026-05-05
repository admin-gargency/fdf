"use server";

/**
 * actions.ts — Server Actions per le Categorie.
 *
 * createCategory: POST /api/categories
 * updateCategory: PUT  /api/categories/:id
 *
 * deleteCategory è gestito via client fetch in CategoryRow ("use client")
 * perché il componente è già client per l'interattività della riga; una
 * Server Action aggiuntiva non apporta valore e aggiunge complessità.
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
// Helper — costruisce l'URL base del server (stesso pattern di funds/page.tsx)
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
// Converte stringa decimale (es. "12,50" o "12.50") in centesimi interi.
// Ritorna null se il valore è vuoto o non parsabile.
// ---------------------------------------------------------------------------

function parseCents(raw: string | null): number | null {
  if (!raw || raw.trim() === "") return null;
  // Normalizza separatore decimale italiano (virgola → punto)
  const normalized = raw.trim().replace(",", ".");
  const float = parseFloat(normalized);
  if (isNaN(float)) return null;
  return Math.round(float * 100);
}

// ---------------------------------------------------------------------------
// createCategory
// ---------------------------------------------------------------------------

export async function createCategory(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const fund_id = (formData.get("fund_id") as string | null) ?? "";
  const sort_order_raw = formData.get("sort_order") as string | null;
  const target_raw = formData.get("target_amount_cents") as string | null;
  const current_raw = formData.get("current_amount_cents") as string | null;

  if (!name) {
    return { status: "error", message: "Il nome è obbligatorio." };
  }
  if (!fund_id) {
    return { status: "error", message: "Seleziona un fondo." };
  }

  const sort_order =
    sort_order_raw && sort_order_raw.trim() !== ""
      ? parseInt(sort_order_raw, 10)
      : 0;

  const target_amount_cents = parseCents(target_raw);
  const current_amount_cents = parseCents(current_raw) ?? 0;

  const body: Record<string, unknown> = {
    fund_id,
    name,
    sort_order,
    current_amount_cents,
  };
  if (target_amount_cents !== null) {
    body.target_amount_cents = target_amount_cents;
  }

  let res: Response;
  try {
    const baseUrl = await buildBaseUrl();
    const cookieHeader = await getCookieHeader();
    res = await fetch(`${baseUrl}/api/categories`, {
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
      message: "Esiste già una categoria con questo nome in questo fondo.",
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
      message: "Fondo non trovato. Seleziona un fondo valido.",
    };
  }

  if (!res.ok) {
    return {
      status: "error",
      message: "Si è verificato un errore. Riprova più tardi.",
    };
  }

  revalidatePath("/categories");
  redirect(`/categories?fund_id=${fund_id}`);
}

// ---------------------------------------------------------------------------
// updateCategory — usata dalla CategoryRow via Server Action import
// (definita qui per completezza e testabilità; CategoryRow usa client fetch
//  come documentato nel piano approvato)
// ---------------------------------------------------------------------------

export async function updateCategory(
  id: string,
  updates: {
    name?: string;
    fund_id?: string;
    sort_order?: number;
    target_amount_cents?: number | null;
    current_amount_cents?: number;
  },
): Promise<{ ok: true } | { ok: false; status: number; code?: string }> {
  let res: Response;
  try {
    const baseUrl = await buildBaseUrl();
    const cookieHeader = await getCookieHeader();
    res = await fetch(`${baseUrl}/api/categories/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify(updates),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (res.ok) {
    revalidatePath("/categories");
    return { ok: true };
  }

  let code: string | undefined;
  try {
    const json = (await res.json()) as { code?: string };
    code = json.code;
  } catch {
    // ignora errori di parsing
  }

  return { ok: false, status: res.status, code };
}
