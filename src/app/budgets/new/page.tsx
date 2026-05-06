/**
 * /budgets/new — Pagina creazione budget (Server Component).
 *
 * Fetch /api/funds per ottenere l'albero classe/categoria con nomi.
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { BudgetForm } from "@/components/budgets/BudgetForm";
import { createBudget } from "@/app/budgets/actions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { ClassOptionForBudget } from "@/components/budgets/BudgetForm";

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

type FundsResult =
  | { ok: true; data: FundTreeNode[] }
  | { ok: false; status: number };

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
// Helper: appiattisce il fund tree → ClassOptionForBudget[]
// (solo classi non archiviate)
// ---------------------------------------------------------------------------

function flattenClassOptions(tree: FundTreeNode[]): ClassOptionForBudget[] {
  const result: ClassOptionForBudget[] = [];
  for (const fund of tree) {
    // Salta fondi archiviati
    if (fund.archived_at !== null) continue;
    for (const cat of fund.categories) {
      // Salta categorie archiviate
      if (cat.archived_at !== null) continue;
      for (const cls of cat.classes) {
        // Salta classi archiviate
        if (cls.archived_at !== null) continue;
        result.push({
          id: cls.id,
          name: cls.name,
          categoryName: cat.name,
          fundName: fund.name,
        });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// searchParams
// ---------------------------------------------------------------------------

interface SearchParams {
  period?: string;
  class_id?: string;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function NewBudgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const defaultPeriod = params.period?.trim().match(/^\d{4}-\d{2}$/)
    ? params.period.trim()
    : currentYearMonth();
  const defaultClassId = params.class_id?.trim() || undefined;

  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const fundsResult = await fetchFunds(baseUrl, cookieHeader);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  if (!fundsResult.ok && fundsResult.status === 401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per creare un budget
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

  if (!fundsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Nuovo budget
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei dati. Riprova più tardi.
        </p>
      </main>
    );
  }

  const classes = flattenClassOptions(fundsResult.data);

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Nuovo budget
        </h1>
        <LogoutButton />
      </div>

      <Link
        href={`/budgets?period=${defaultPeriod}`}
        className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
      >
        ← Torna ai budget
      </Link>

      {/* Avviso nessuna classe disponibile */}
      {classes.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Non hai ancora classi di spesa configurate. Crea prima un fondo, una
            categoria e almeno una classe prima di definire un budget.
          </p>
          <Link
            href="/funds"
            className="mt-2 inline-block text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            Vai ai fondi →
          </Link>
        </div>
      )}

      {/* Form budget */}
      <BudgetForm
        classes={classes}
        defaultPeriod={defaultPeriod}
        defaultClassId={defaultClassId}
        action={createBudget}
      />
    </main>
  );
}
