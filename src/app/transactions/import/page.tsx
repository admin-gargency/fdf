/**
 * /transactions/import — Pagina import CSV transazioni (Server Component).
 *
 * Fetch /api/accounts server-side (pattern transactions/new/page.tsx).
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 * Client island: CsvImportForm riceve accounts come props serializzabili.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { CsvImportForm } from "@/components/csv-import/CsvImportForm";
import type { AccountOption } from "@/components/csv-import/AccountSelector";

// ---------------------------------------------------------------------------
// Helper URL base (colocato — pattern F3-F6)
// ---------------------------------------------------------------------------

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// Tipo risultato fetch
// ---------------------------------------------------------------------------

type AccountsResult =
  | { ok: true; data: AccountOption[] }
  | { ok: false; status: number };

// ---------------------------------------------------------------------------
// Fetch accounts
// ---------------------------------------------------------------------------

async function fetchAccounts(
  baseUrl: string,
  cookieHeader: string,
): Promise<AccountsResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/accounts`, {
      cache: "no-store",
      headers: { Cookie: cookieHeader },
    });
  } catch {
    return { ok: false, status: 500 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { id: string; name: string; kind: string }[];
  return {
    ok: true,
    data: data.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  };
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function ImportCsvPage() {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const accountsResult = await fetchAccounts(baseUrl, cookieHeader);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  if (!accountsResult.ok && accountsResult.status === 401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per importare le transazioni
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Devi essere autenticato per accedere a questa pagina. Accedi al tuo
          account per continuare.
        </p>
        <Link
          href="/login"
          className="self-start text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
        >
          Vai al login
        </Link>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Errore generico
  // ---------------------------------------------------------------------------

  if (!accountsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Importa transazioni
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei dati. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  const accounts = accountsResult.data;

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Importa transazioni
        </h1>
        <LogoutButton />
      </div>

      <Link
        href="/transactions"
        className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
      >
        ← Torna alle transazioni
      </Link>

      {/* Descrizione */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Importa le tue transazioni da un file CSV esportato dalla tua banca.
          Supporta il formato Fineco Bank e formati generici con mapping manuale
          delle colonne.
        </p>
      </div>

      {/* Form client island */}
      <CsvImportForm accounts={accounts} />
    </main>
  );
}
