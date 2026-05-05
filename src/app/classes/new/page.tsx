/**
 * /classes/new — Pagina creazione classe (Server Component).
 *
 * Richiede entrambi ?fund_id e ?category_id. Se mancanti, mostra un guard
 * con link di ritorno a /classes (opzione b approvata).
 *
 * Recupera le categorie per il fondo selezionato, filtrando le opzioni
 * nel form. Il reparent tra fondi diversi è solo in edit-mode.
 *
 * Delega la mutazione a createClass (Server Action in actions.ts).
 * ClassForm è "use client" per gestire useActionState e useFormStatus.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ClassForm } from "@/components/classes/ClassForm";
import { createClass } from "@/app/classes/actions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { CategoryOption } from "@/components/classes/CategorySelector";

// ---------------------------------------------------------------------------
// Fetch fondi (per verificare esistenza + ottenere nomi)
// ---------------------------------------------------------------------------

type FundsResult =
  | { ok: true; data: { id: string; name: string }[] }
  | { ok: false; status: number };

type CategoriesResult =
  | { ok: true; data: CategoryOption[] }
  | { ok: false; status: number };

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

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
  return { ok: true, data: tree.map((f) => ({ id: f.id, name: f.name })) };
}

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
  return {
    ok: true,
    data: data.map((c) => ({ id: c.id, name: c.name })),
  };
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

interface SearchParams {
  fund_id?: string;
  category_id?: string;
}

export default async function NewClassPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const fundId = params.fund_id?.trim() || undefined;
  const categoryId = params.category_id?.trim() || undefined;

  // Guard: entrambi i param richiesti
  if (!fundId || !categoryId) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Nuova classe
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Per aggiungere una classe seleziona prima fondo e categoria dalla
          lista.
        </p>
        <Link
          href="/classes"
          className="self-start text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
        >
          ← Torna alle classi
        </Link>
      </main>
    );
  }

  // Fetch fondi e categorie in parallelo
  const [fundsResult, categoriesResult] = await Promise.all([
    fetchFunds(),
    fetchCategories(fundId),
  ]);

  // ---------------------------------------------------------------------------
  // 401
  // ---------------------------------------------------------------------------

  const is401 =
    (!fundsResult.ok && fundsResult.status === 401) ||
    (!categoriesResult.ok && categoriesResult.status === 401);

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
  // Errore generico fetch
  // ---------------------------------------------------------------------------

  if (!fundsResult.ok || !categoriesResult.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Nuova classe
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei dati. Riprova più tardi.
        </p>
      </main>
    );
  }

  const funds = fundsResult.data;
  const categories = categoriesResult.data;

  // ---------------------------------------------------------------------------
  // Guard: nessun fondo
  // ---------------------------------------------------------------------------

  if (funds.length === 0) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nuova classe
          </h1>
          <LogoutButton />
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Per creare una classe devi prima avere almeno un fondo e una
          categoria. Vai a{" "}
          <Link
            href="/funds"
            className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            /funds
          </Link>
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Guard: nessuna categoria per il fondo
  // ---------------------------------------------------------------------------

  if (categories.length === 0) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nuova classe
          </h1>
          <LogoutButton />
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Nessuna categoria trovata per questo fondo. Crea prima una categoria.
          Vai a{" "}
          <Link
            href={`/categories?fund_id=${fundId}`}
            className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            /categories?fund_id={fundId}
          </Link>
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render principale
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Nuova classe
        </h1>
        <LogoutButton />
      </div>

      {/* Link ritorno */}
      <Link
        href={`/classes?fund_id=${fundId}&category_id=${categoryId}`}
        className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
      >
        ← Torna alle classi
      </Link>

      {/* Form */}
      <ClassForm
        action={createClass}
        categories={categories}
        defaultCategoryId={categoryId}
        defaultFundId={fundId}
        submitLabel="Crea classe"
      />
    </main>
  );
}
