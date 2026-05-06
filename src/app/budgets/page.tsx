/**
 * /budgets — Pagina budget mensile (Server Component).
 *
 * searchParams: period? (YYYY-MM) — default = mese corrente.
 *
 * Fetch parallelo:
 * - /api/budgets?period=YYYY-MM — budget dell'household per il mese
 * - /api/transactions?month=YYYY-MM — transazioni del mese (per actual spend)
 * - /api/funds — albero fondo/categoria/classe (per i nomi)
 *
 * Compute server-side: calculateBudgetVsActual + enrichment nomi.
 *
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { BudgetTable } from "@/components/budgets/BudgetTable";
import { MonthSelector } from "@/components/budgets/MonthSelector";
import { calculateBudgetVsActual } from "@/lib/domain/budgets";
import type { Budget } from "@/lib/domain/budgets";
import type { TransactionRow } from "@/lib/domain/transactions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { BudgetRowItem } from "@/components/budgets/BudgetRow";

// ---------------------------------------------------------------------------
// Helper URL base
// ---------------------------------------------------------------------------

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// Helper: mese corrente in formato YYYY-MM
// ---------------------------------------------------------------------------

function currentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ---------------------------------------------------------------------------
// Tipi risultato fetch
// ---------------------------------------------------------------------------

type BudgetsResult =
  | { ok: true; data: Budget[] }
  | { ok: false; status: number };

type TransactionsResult =
  | { ok: true; data: TransactionRow[] }
  | { ok: false; status: number };

type FundsResult =
  | { ok: true; data: FundTreeNode[] }
  | { ok: false; status: number };

// ---------------------------------------------------------------------------
// Fetch budgets
// ---------------------------------------------------------------------------

async function fetchBudgets(
  baseUrl: string,
  cookieHeader: string,
  period: string,
): Promise<BudgetsResult> {
  const url = new URL(`${baseUrl}/api/budgets`);
  url.searchParams.set("period", period);

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
  const data = (await res.json()) as Budget[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Fetch transactions
// ---------------------------------------------------------------------------

async function fetchTransactions(
  baseUrl: string,
  cookieHeader: string,
  month: string,
): Promise<TransactionsResult> {
  const url = new URL(`${baseUrl}/api/transactions`);
  url.searchParams.set("month", month);
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
// Fetch fund tree (per nomi classe/categoria)
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
// Helper: mappa classId → { className, categoryName } dal fund tree
// ---------------------------------------------------------------------------

interface ClassMeta {
  className: string;
  categoryName: string;
}

function buildClassMetaMap(tree: FundTreeNode[]): Map<string, ClassMeta> {
  const map = new Map<string, ClassMeta>();
  for (const fund of tree) {
    for (const cat of fund.categories) {
      for (const cls of cat.classes) {
        map.set(cls.id, {
          className: cls.name,
          categoryName: cat.name,
        });
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helper: arricchisce BudgetSummary[] con nomi classe/categoria + budget id
// ---------------------------------------------------------------------------

function enrichBudgetSummaries(
  summaries: ReturnType<typeof calculateBudgetVsActual>,
  budgets: Budget[],
  classMeta: Map<string, ClassMeta>,
): BudgetRowItem[] {
  const budgetById = new Map(budgets.map((b) => [b.class_id, b]));

  return summaries.map((s) => {
    const budget = budgetById.get(s.class_id);
    const meta = classMeta.get(s.class_id);
    return {
      ...s,
      id: budget?.id ?? s.class_id,
      class_name: meta?.className ?? s.class_id,
      category_name: meta?.categoryName ?? "Senza categoria",
    };
  });
}

// ---------------------------------------------------------------------------
// searchParams
// ---------------------------------------------------------------------------

interface SearchParams {
  period?: string;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const period = params.period?.trim().match(/^\d{4}-\d{2}$/)
    ? params.period.trim()
    : currentYearMonth();

  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  // Fetch parallelo: budget + transazioni + fund tree
  const [budgetsResult, transactionsResult, fundsResult] = await Promise.all([
    fetchBudgets(baseUrl, cookieHeader, period),
    fetchTransactions(baseUrl, cookieHeader, period),
    fetchFunds(baseUrl, cookieHeader),
  ]);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  const is401 =
    (!budgetsResult.ok && budgetsResult.status === 401) ||
    (!transactionsResult.ok && transactionsResult.status === 401) ||
    (!fundsResult.ok && fundsResult.status === 401);

  if (is401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per visualizzare i tuoi budget
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

  if (!budgetsResult.ok || !transactionsResult.ok || !fundsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          I tuoi budget
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore. Riprova più tardi.
        </p>
      </main>
    );
  }

  const budgets = budgetsResult.data;
  const transactions = transactionsResult.data;
  const fundTree = fundsResult.data;

  // Compute budget vs actual server-side
  const summaries = calculateBudgetVsActual(budgets, transactions, period);

  // Arricchisci con nomi classe/categoria dal fund tree
  const classMeta = buildClassMetaMap(fundTree);
  const enrichedRows = enrichBudgetSummaries(summaries, budgets, classMeta);

  // Totali header
  const totalBudget = enrichedRows.reduce((s, r) => s + r.budget_cents, 0);
  const totalActual = enrichedRows.reduce((s, r) => s + r.actual_cents, 0);

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          I tuoi budget
        </h1>
        <LogoutButton />
      </div>

      {/* Selettore mese + CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <MonthSelector currentPeriod={period} />
        <Link
          href={`/budgets/new?period=${period}`}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
        >
          Aggiungi budget
        </Link>
      </div>

      {/* Riepilogo mensile */}
      {enrichedRows.length > 0 && (
        <section
          aria-label="Riepilogo mensile"
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Riepilogo {period}
          </h2>
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                Totale pianificato
              </dt>
              <dd className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {new Intl.NumberFormat("it-IT", {
                  style: "currency",
                  currency: "EUR",
                }).format(totalBudget / 100)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                Totale speso
              </dt>
              <dd className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {new Intl.NumberFormat("it-IT", {
                  style: "currency",
                  currency: "EUR",
                }).format(totalActual / 100)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                Differenza
              </dt>
              <dd
                className={`text-base font-semibold tabular-nums ${
                  totalActual > totalBudget
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {totalActual > totalBudget ? "" : "+"}
                {new Intl.NumberFormat("it-IT", {
                  style: "currency",
                  currency: "EUR",
                }).format((totalBudget - totalActual) / 100)}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* Empty state */}
      {enrichedRows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Nessun budget definito per questo mese. Aggiungi il tuo primo
            budget.
          </p>
          <Link
            href={`/budgets/new?period=${period}`}
            className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
          >
            Aggiungi il primo budget
          </Link>
        </div>
      ) : (
        /* Tabella budget raggruppata per categoria */
        <section aria-label="Budget per categoria">
          <BudgetTable rows={enrichedRows} />
        </section>
      )}
    </main>
  );
}
