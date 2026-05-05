/**
 * /categories/new — Pagina creazione categoria (Server Component).
 *
 * Legge ?fund_id dai searchParams per pre-selezionare il fondo.
 * Recupera la lista fondi per popolare il selettore (l'utente può scegliere
 * un fondo diverso dal pre-selezionato).
 *
 * Delega la mutazione a createCategory (Server Action in actions.ts).
 * CategoryForm è "use client" per gestire useActionState e useFormStatus.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { CategoryForm } from "@/components/categories/CategoryForm";
import { createCategory } from "@/app/categories/actions";
import type { FundTreeNode } from "@/lib/domain/funds";
import type { FundOption } from "@/components/categories/FundSelector";

// ---------------------------------------------------------------------------
// Fetch fondi (stesso pattern di categories/page.tsx)
// ---------------------------------------------------------------------------

type FundsResult =
  | { ok: true; data: FundOption[] }
  | { ok: false; status: number };

async function fetchFunds(): Promise<FundsResult> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${protocol}://${host}`;

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
// Pagina
// ---------------------------------------------------------------------------

interface SearchParams {
  fund_id?: string;
}

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const defaultFundId = params.fund_id?.trim() || undefined;

  const fundsResult = await fetchFunds();

  // ---------------------------------------------------------------------------
  // 401
  // ---------------------------------------------------------------------------

  if (!fundsResult.ok && fundsResult.status === 401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per continuare
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Devi essere autenticato per creare una categoria. Accedi al tuo
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
          Nuova categoria
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei fondi. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  const funds = fundsResult.data;

  // ---------------------------------------------------------------------------
  // Nessun fondo disponibile
  // ---------------------------------------------------------------------------

  if (funds.length === 0) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nuova categoria
          </h1>
          <LogoutButton />
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Per creare una categoria devi prima avere almeno un fondo. Vai alla
          pagina{" "}
          <Link
            href="/funds"
            className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            Fondi
          </Link>{" "}
          per creare il tuo primo fondo.
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
          Nuova categoria
        </h1>
        <LogoutButton />
      </div>

      {/* Link ritorno */}
      <Link
        href={
          defaultFundId
            ? `/categories?fund_id=${defaultFundId}`
            : "/categories"
        }
        className="self-start text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
      >
        ← Torna alle categorie
      </Link>

      {/* Form */}
      <CategoryForm
        action={createCategory}
        funds={funds}
        defaultFundId={defaultFundId}
        submitLabel="Crea categoria"
      />
    </main>
  );
}
