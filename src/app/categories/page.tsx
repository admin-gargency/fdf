/**
 * /categories — Pagina categorie (Server Component).
 *
 * Legge ?fund_id e ?include_archived dai searchParams.
 * Se fund_id assente: mostra solo il selettore fondo.
 * Se fund_id presente: recupera le categorie e mostra la lista.
 *
 * 401 gestito in-page (no redirect, no modifica a proxy.ts).
 * Pattern identico a src/app/funds/page.tsx.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { FundSelector, type FundOption } from "@/components/categories/FundSelector";
import { CategoryList } from "@/components/categories/CategoryList";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { CategoryRow } from "@/components/categories/CategoryRow";

// ---------------------------------------------------------------------------
// Tipi risultato fetch
// ---------------------------------------------------------------------------

type FundsResult =
  | { ok: true; data: FundOption[] }
  | { ok: false; status: number };

type CategoriesResult =
  | { ok: true; data: CategoryRow[] }
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
// Fetch fondi (per selettore)
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
  // Estrae solo id e name — non duplica logica di dominio
  const funds: FundOption[] = tree.map((f) => ({ id: f.id, name: f.name }));
  return { ok: true, data: funds };
}

// ---------------------------------------------------------------------------
// Fetch categorie per fondo
// ---------------------------------------------------------------------------

async function fetchCategories(
  fundId: string,
  includeArchived: boolean,
): Promise<CategoriesResult> {
  const baseUrl = await buildBaseUrl();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const url = new URL(`${baseUrl}/api/categories`);
  url.searchParams.set("fund_id", fundId);
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

  const data = (await res.json()) as CategoryRow[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

interface SearchParams {
  fund_id?: string;
  include_archived?: string;
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const fundId = params.fund_id?.trim() || undefined;
  const includeArchived = params.include_archived === "true";

  // Fetch fondi sempre (necessario per il selettore)
  // Fetch categorie solo se fund_id presente — parallelizzato quando entrambi
  const [fundsResult, categoriesResult] = await Promise.all([
    fetchFunds(),
    fundId ? fetchCategories(fundId, includeArchived) : Promise.resolve(null),
  ]);

  // ---------------------------------------------------------------------------
  // 401 — gestione in-page
  // ---------------------------------------------------------------------------

  if (
    (!fundsResult.ok && fundsResult.status === 401) ||
    (categoriesResult && !categoriesResult.ok && categoriesResult.status === 401)
  ) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per visualizzare le tue categorie
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
          Le tue categorie
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore. Riprova più tardi.
        </p>
      </main>
    );
  }

  const funds = fundsResult.data;

  // ---------------------------------------------------------------------------
  // Errore generico categorie (fund_id presente ma fetch fallita)
  // ---------------------------------------------------------------------------

  if (categoriesResult && !categoriesResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Le tue categorie
          </h1>
          <LogoutButton />
        </div>
        <FundSelector funds={funds} selectedFundId={fundId} includeArchived={includeArchived} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento delle categorie. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  const categories = categoriesResult?.data ?? null;

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Le tue categorie
        </h1>
        <LogoutButton />
      </div>

      {/* Selettore fondo */}
      <FundSelector
        funds={funds}
        selectedFundId={fundId}
        includeArchived={includeArchived}
      />

      {/* Contenuto condizionale: solo quando un fondo è selezionato */}
      {fundId && categories !== null && (
        <>
          {categories.length === 0 ? (
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Non hai ancora creato categorie per questo fondo. Quando
              aggiungerai la prima categoria, apparirà qui.
            </p>
          ) : (
            <CategoryList
              categories={categories}
              funds={funds}
              includeArchived={includeArchived}
            />
          )}

          {/* CTA crea nuova categoria */}
          <Link
            href={`/categories/new?fund_id=${fundId}`}
            className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
          >
            Aggiungi categoria
          </Link>
        </>
      )}

      {/* Nessun fondo selezionato: invito alla selezione */}
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
    </main>
  );
}
