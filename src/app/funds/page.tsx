/**
 * /funds — Pagina fondi (Server Component).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { cookies, headers } from "next/headers";
import type { FundTreeNode } from "@/lib/domain/funds";
import { FundTree } from "@/components/funds/FundTree";
import { LogoutButton } from "@/components/auth/LogoutButton";

// ---------------------------------------------------------------------------
// Fetch interno via route handler /api/funds
// ---------------------------------------------------------------------------

type FundsApiResult =
  | { ok: true; data: FundTreeNode[] }
  | { ok: false; status: 401 }
  | { ok: false; status: number };

async function fetchFunds(): Promise<FundsApiResult> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  const url = `${protocol}://${host}/api/funds`;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { Cookie: cookieHeader },
    });
  } catch {
    return { ok: false, status: 500 };
  }

  if (res.status === 401) {
    return { ok: false, status: 401 };
  }

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as FundTreeNode[];
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function FundsPage() {
  const result = await fetchFunds();

  if (!result.ok && result.status === 401) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Accedi per visualizzare i tuoi fondi
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Devi essere autenticato per accedere a questa pagina. Accedi al tuo
          account per continuare.
        </p>
      </main>
    );
  }

  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          I tuoi fondi
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore. Riprova più tardi.
        </p>
      </main>
    );
  }

  const tree = result.data;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          I tuoi fondi
        </h1>
        <LogoutButton />
      </div>
      {tree.length === 0 ? (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Non hai ancora creato fondi. Quando creerai il tuo primo fondo,
          apparirà qui.
        </p>
      ) : (
        <FundTree tree={tree} />
      )}
    </main>
  );
}
