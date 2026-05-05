/**
 * /transactions — Pagina lista transazioni (Server Component).
 *
 * searchParams: account_id?, class_id?, month? (YYYY-MM).
 *
 * Fetch parallelo:
 * - /api/accounts — per il filtro conto
 * - /api/funds — per l'albero fondo/categoria/classe (filtro e assegnazione)
 * - /api/transactions?... — lista filtrata (limit=200)
 *
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { TransactionList } from "@/components/transactions/TransactionList";
import { MonthlyAggregation } from "@/components/transactions/MonthlyAggregation";
import { aggregateByMonth } from "@/lib/domain/transactions";
import type { TransactionRow } from "@/lib/domain/transactions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { AccountOption } from "@/components/transactions/TransactionForm";
import type { TransactionItem } from "@/components/transactions/TransactionRow";
import type { ClassOption } from "@/components/transactions/TransactionForm";

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

type TransactionsResult =
  | { ok: true; data: TransactionRow[] }
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
// Fetch transactions
// ---------------------------------------------------------------------------

async function fetchTransactions(
  baseUrl: string,
  cookieHeader: string,
  params: { account_id?: string; class_id?: string; month?: string },
): Promise<TransactionsResult> {
  const url = new URL(`${baseUrl}/api/transactions`);
  if (params.account_id) url.searchParams.set("account_id", params.account_id);
  if (params.class_id) url.searchParams.set("class_id", params.class_id);
  if (params.month) url.searchParams.set("month", params.month);
  url.searchParams.set("limit", "200");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Cookie: cookieHeader },
    });
  } catch {
    return { ok: false, status: 500 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as TransactionRow[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Helpers: appiattimento fund tree → ClassOption[]
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
// Mappa transazioni con nomi account/classe per la vista
// ---------------------------------------------------------------------------

function enrichTransactions(
  rows: TransactionRow[],
  accounts: AccountOption[],
  classes: ClassOption[],
): TransactionItem[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const classMap = new Map(classes.map((c) => [c.id, c.name]));

  return rows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    accountName: accountMap.get(row.account_id) ?? "Conto sconosciuto",
    class_id: row.class_id,
    className: row.class_id ? (classMap.get(row.class_id) ?? null) : null,
    booked_at: row.booked_at,
    amount_cents: row.amount_cents,
    description: row.description,
  }));
}

// ---------------------------------------------------------------------------
// searchParams
// ---------------------------------------------------------------------------

interface SearchParams {
  account_id?: string;
  class_id?: string;
  month?: string;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const accountId = params.account_id?.trim() || undefined;
  const classId = params.class_id?.trim() || undefined;
  const month = params.month?.trim() || undefined;

  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  // Fetch parallelo
  const [accountsResult, fundsResult, transactionsResult] = await Promise.all([
    fetchAccounts(baseUrl, cookieHeader),
    fetchFunds(baseUrl, cookieHeader),
    fetchTransactions(baseUrl, cookieHeader, {
      account_id: accountId,
      class_id: classId,
      month,
    }),
  ]);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  const is401 =
    (!accountsResult.ok && accountsResult.status === 401) ||
    (!fundsResult.ok && fundsResult.status === 401) ||
    (!transactionsResult.ok && transactionsResult.status === 401);

  if (is401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per visualizzare le tue transazioni
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

  if (!accountsResult.ok || !fundsResult.ok || !transactionsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Le tue transazioni
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore. Riprova più tardi.
        </p>
      </main>
    );
  }

  const accounts = accountsResult.data;
  const fundTree = fundsResult.data;
  const transactions = transactionsResult.data;
  const classes = flattenClassOptions(fundTree);
  const enriched = enrichTransactions(transactions, accounts, classes);
  const monthly = aggregateByMonth(transactions);

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Le tue transazioni
        </h1>
        <LogoutButton />
      </div>

      {/* CTA nuova transazione */}
      <div className="flex items-center justify-between">
        <Link
          href="/transactions/new"
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
        >
          Aggiungi transazione
        </Link>
      </div>

      {/* Filtri */}
      <TransactionFilters
        accounts={accounts}
        fundTree={fundTree}
        selectedAccountId={accountId}
        selectedClassId={classId}
        selectedMonth={month}
      />

      {/* Riepilogo mensile */}
      {monthly.length > 0 && (
        <section aria-label="Riepilogo mensile">
          <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Riepilogo mensile
          </h2>
          <MonthlyAggregation monthly={monthly} />
        </section>
      )}

      {/* Lista transazioni */}
      <section aria-label="Elenco transazioni">
        <TransactionList transactions={enriched} classes={classes} />
      </section>
    </main>
  );
}
