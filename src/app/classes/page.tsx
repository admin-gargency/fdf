/**
 * /classes — Pagina classi (Server Component).
 *
 * Legge ?fund_id, ?category_id e ?include_archived dai searchParams.
 *
 * - Nessun param: mostra solo il selettore fondo.
 * - fund_id: carica categorie per quel fondo, mostra selettore a due livelli.
 * - fund_id + category_id: carica classi, mostra la lista.
 *
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 * Pattern identico a src/app/categories/page.tsx.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import {
  CategorySelector,
  type FundOption,
  type CategoryOption,
} from "@/components/classes/CategorySelector";
import { ClassList } from "@/components/classes/ClassList";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { ClassRow } from "@/components/classes/ClassRow";

// ---------------------------------------------------------------------------
// Tipi risultato fetch
// ---------------------------------------------------------------------------

type FundsResult =
  | { ok: true; data: FundOption[] }
  | { ok: false; status: number };

type CategoriesResult =
  | { ok: true; data: CategoryOption[] }
  | { ok: false; status: number };

type ClassesResult =
  | { ok: true; data: ClassRow[] }
  | { ok: false; status: number };

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
// Fetch fondi
// ---------------------------------------------------------------------------

async function fetchFunds(): Promise<FundsResult> {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

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

  const tree = (await res.json()) as FundTreeNode[];
  const funds: FundOption[] = tree.map((f) => ({ id: f.id, name: f.name }));
  return { ok: true, data: funds };
}

// ---------------------------------------------------------------------------
// Fetch categorie per fondo (per il selettore a due livelli)
// ---------------------------------------------------------------------------

async function fetchCategories(fundId: string): Promise<CategoriesResult> {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const url = new URL(`${baseUrl}/api/categories`);
  url.searchParams.set("fund_id", fundId);

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

  const data = (await res.json()) as { id: string; name: string }[];
  const categories: CategoryOption[] = data.map((c) => ({
    id: c.id,
    name: c.name,
  }));
  return { ok: true, data: categories };
}

// ---------------------------------------------------------------------------
// Fetch classi per categoria
// ---------------------------------------------------------------------------

async function fetchClasses(
  categoryId: string,
  includeArchived: boolean,
): Promise<ClassesResult> {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const url = new URL(`${baseUrl}/api/classes`);
  url.searchParams.set("category_id", categoryId);
  if (includeArchived) url.searchParams.set("include_archived", "true");

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

  const data = (await res.json()) as ClassRow[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

interface SearchParams {
  fund_id?: string;
  category_id?: string;
  include_archived?: string;
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const fundId = params.fund_id?.trim() || undefined;
  const categoryId = params.category_id?.trim() || undefined;
  const includeArchived = params.include_archived === "true";

  // Fetch fondi sempre (necessario per il selettore).
  // Fetch categorie solo se fund_id presente.
  // Fetch classi solo se category_id presente — parallelizzato con categorie.
  const [fundsResult, categoriesResult, classesResult] = await Promise.all([
    fetchFunds(),
    fundId ? fetchCategories(fundId) : Promise.resolve(null),
    categoryId
      ? fetchClasses(categoryId, includeArchived)
      : Promise.resolve(null),
  ]);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  const is401 =
    (!fundsResult.ok && fundsResult.status === 401) ||
    (categoriesResult && !categoriesResult.ok && categoriesResult.status === 401) ||
    (classesResult && !classesResult.ok && classesResult.status === 401);

  if (is401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per visualizzare le tue classi
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
  // Errore generico fondi
  // ---------------------------------------------------------------------------

  if (!fundsResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Le tue classi
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore. Riprova più tardi.
        </p>
      </main>
    );
  }

  const funds = fundsResult.data;

  // ---------------------------------------------------------------------------
  // Errore generico categorie o classi
  // ---------------------------------------------------------------------------

  if (categoriesResult && !categoriesResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Le tue classi
          </h1>
          <LogoutButton />
        </div>
        <CategorySelector
          funds={funds}
          selectedFundId={fundId}
          selectedCategoryId={categoryId}
          includeArchived={includeArchived}
        />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento delle categorie. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  if (classesResult && !classesResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Le tue classi
          </h1>
          <LogoutButton />
        </div>
        <CategorySelector
          funds={funds}
          categories={categoriesResult?.data}
          selectedFundId={fundId}
          selectedCategoryId={categoryId}
          includeArchived={includeArchived}
        />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento delle classi. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  const categories = categoriesResult?.data ?? undefined;
  const classes = classesResult?.data ?? null;

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Le tue classi
        </h1>
        <LogoutButton />
      </div>

      {/* Selettore a due livelli Fondo → Categoria */}
      <CategorySelector
        funds={funds}
        categories={categories}
        selectedFundId={fundId}
        selectedCategoryId={categoryId}
        includeArchived={includeArchived}
      />

      {/* Nessun fondo disponibile */}
      {!fundId && funds.length === 0 && (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Non hai ancora creato fondi. Vai alla pagina{" "}
          <Link
            href="/funds"
            className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            Fondi
          </Link>{" "}
          per creare il tuo primo fondo.
        </p>
      )}

      {/* Fondo selezionato, nessuna categoria disponibile */}
      {fundId && categories && categories.length === 0 && (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Seleziona una categoria per vedere le classi.
        </p>
      )}

      {/* Fondo selezionato, nessuna categoria ancora selezionata */}
      {fundId && !categoryId && categories && categories.length > 0 && (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Seleziona una categoria per vedere le classi.
        </p>
      )}

      {/* Nessun fondo selezionato: invito alla selezione */}
      {!fundId && funds.length > 0 && (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Seleziona un fondo per vedere le categorie disponibili.
        </p>
      )}

      {/* Lista classi */}
      {fundId && categoryId && classes !== null && (
        <>
          {classes.length === 0 ? (
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Nessuna classe in questa categoria. Creane una.
            </p>
          ) : (
            <ClassList
              classes={classes}
              categories={categories ?? []}
              includeArchived={includeArchived}
            />
          )}

          {/* CTA crea nuova classe */}
          <Link
            href={`/classes/new?fund_id=${fundId}&category_id=${categoryId}`}
            className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
          >
            Aggiungi classe
          </Link>
        </>
      )}
    </main>
  );
}
