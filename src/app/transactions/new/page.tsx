/**
 * /transactions/new — Pagina creazione transazione (Server Component).
 *
 * Fetch /api/accounts e /api/funds in parallelo.
 * Branching:
 * - 0 conti → mostra FirstAccountForm (crea il primo conto prima di procedere)
 * - ≥1 conti → mostra TransactionForm con selezione conto e classe
 *
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { FirstAccountForm } from "@/components/transactions/FirstAccountForm";
import { createTransaction, createFirstAccount } from "@/app/transactions/actions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { AccountOption, ClassOption } from "@/components/transactions/TransactionForm";

// ---------------------------------------------------------------------------
// Helper URL base (colocato — non estrarre, pattern F3-F5)
// ---------------------------------------------------------------------------

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// Tipi risultato fetch
// ---------------------------------------------------------------------------

type AccountsResult =
  | { ok: true; data: AccountOption[] }
  | { ok: false; status: number };

type FundsResult =
  | { ok: true; data: FundTreeNode[] }
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
  return { ok: true, data: data.map((a) => ({ id: a.id, name: a.name, kind: a.kind })) };
}

// ---------------------------------------------------------------------------
// Fetch fund tree
// ---------------------------------------------------------------------------

async function fetchFunds(
  baseUrl: string,
  cookieHeader: string,
): Promise<FundsResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/funds`, {
      cache: "no-store",
      headers: { Cookie: cookieHeader },
    });
  } catch {
    return { ok: false, status: 500 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as FundTreeNode[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Helper: appiattimento fund tree → ClassOption[]
// ---------------------------------------------------------------------------

function flattenClassOptions(tree: FundTreeNode[]): ClassOption[] {
  const result: ClassOption[] = [];
  for (const fund of tree) {
    for (const cat of fund.categories) {
      for (const cls of cat.classes) {
        result.push({
          id: cls.id,
          name: cls.name,
          fundName: fund.name,
          categoryName: cat.name,
        });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function NewTransactionPage() {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const [accountsResult, fundsResult] = await Promise.all([
    fetchAccounts(baseUrl, cookieHeader),
    fetchFunds(baseUrl, cookieHeader),
  ]);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  const is401 =
    (!accountsResult.ok && accountsResult.status === 401) ||
    (!fundsResult.ok && fundsResult.status === 401);

  if (is401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per registrare una transazione
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

  if (!accountsResult.ok || !fundsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Nuova transazione
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei dati. Riprova più tardi.
        </p>
      </main>
    );
  }

  const accounts = accountsResult.data;
  const fundTree = fundsResult.data;
  const classes = flattenClassOptions(fundTree);

  // ---------------------------------------------------------------------------
  // Branching: nessun conto → FirstAccountForm
  // ---------------------------------------------------------------------------

  if (accounts.length === 0) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nuova transazione
          </h1>
          <LogoutButton />
        </div>

        <Link
          href="/transactions"
          className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
        >
          ← Torna alle transazioni
        </Link>

        {/* Avviso nessun conto */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Per registrare una transazione devi prima creare un conto. Crea il
            tuo primo conto qui sotto.
          </p>
        </div>

        {/* Form primo conto */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Crea il tuo primo conto
          </h2>
          <FirstAccountForm action={createFirstAccount} />
        </section>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render principale: form transazione
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Nuova transazione
        </h1>
        <LogoutButton />
      </div>

      <Link
        href="/transactions"
        className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
      >
        ← Torna alle transazioni
      </Link>

      {/* Form transazione */}
      <TransactionForm
        accounts={accounts}
        classes={classes}
        action={createTransaction}
        submitLabel="Registra transazione"
      />
    </main>
  );
}
