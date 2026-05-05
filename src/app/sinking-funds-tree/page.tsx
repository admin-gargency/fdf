/**
 * /sinking-funds-tree — Pagina di sola lettura dell'albero sinking funds.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 * Feature 5: FEATURE-5-BRIEF.md §"Frontend".
 *
 * ## Scelta fetch: Supabase diretto (non HTTP round-trip)
 * La pagina è un Server Component in esecuzione sullo stesso host dei route
 * handler. Anziché fare fetch verso `/api/sinking-funds-tree` (che richiede
 * di costruire l'URL assoluto e propagare i cookie), usa direttamente
 * `getServerSupabaseClient()` + le query Supabase + `buildSinkingFundTree`.
 * La logica di query è identica a quella del route handler — non estratta
 * in un helper condiviso (fuori scope F5; vedi FEATURE-5-BRIEF.md §"Non-goals").
 *
 * ## Auth gate
 * Gate inline: `getUser()` → redirect('/login') se non autenticato.
 * Non modifica `src/proxy.ts` (file condiviso, ASK al lead richiesto).
 */

import { redirect } from "next/navigation";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  FundRowSchema,
  CategoryRowSchema,
  ClassRowSchema,
  SinkingFundRowSchema,
} from "@/lib/domain/funds";
import { buildSinkingFundTree } from "@/lib/domain/sinking-funds-tree";
import { SinkingFundTreeView } from "@/components/sinking-funds-tree/SinkingFundTreeView";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export default async function SinkingFundsTreePage() {
  // 1. Inizializza client SSR
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Servizio non disponibile
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore di configurazione. Riprova più tardi.
        </p>
      </main>
    );
  }

  // 2. Verifica autenticazione — getUser() (non getSession()) per sicurezza
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    redirect("/login");
  }

  // 3. Query 4 tabelle in parallelo — RLS filtra per household automaticamente.
  //    archived_at IS NULL applicato esplicitamente su funds/categories/classes.
  //    sinking_funds: nessuna colonna archived_at.
  //    Colonne selezionate allineate ai GRANT SELECT (grants.sql L162-163).
  //    `sinking_funds.notes` deliberatamente escluso (PII, ungranted).
  const [fundsResult, categoriesResult, classesResult, sinkingFundsResult] =
    await Promise.all([
      supabase
        .from("funds")
        .select(
          "id, household_id, default_account_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
        )
        .is("archived_at", null)
        .order("sort_order"),

      supabase
        .from("categories")
        .select(
          "id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
        )
        .is("archived_at", null)
        .order("sort_order"),

      supabase
        .from("classes")
        .select(
          "id, household_id, category_id, name, tipologia, sort_order, archived_at, created_at, updated_at",
        )
        .is("archived_at", null)
        .order("sort_order"),

      supabase
        .from("sinking_funds")
        .select(
          "id, household_id, class_id, target_cents, target_date, monthly_contribution_cents, created_at, updated_at",
        ),
    ]);

  // 4. Gestione errori DB — errore non-auth → pagina di errore
  if (
    fundsResult.error ??
    categoriesResult.error ??
    classesResult.error ??
    sinkingFundsResult.error
  ) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Piano di accantonamento
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Si è verificato un errore nel caricamento dei dati. Riprova più
          tardi.
        </p>
      </main>
    );
  }

  // 5. Valida con Zod — errore di schema → pagina di errore
  const fundsParseResult = FundRowSchema.array().safeParse(
    fundsResult.data ?? [],
  );
  const categoriesParseResult = CategoryRowSchema.array().safeParse(
    categoriesResult.data ?? [],
  );
  const classesParseResult = ClassRowSchema.array().safeParse(
    classesResult.data ?? [],
  );
  const sinkingFundsParseResult = SinkingFundRowSchema.array().safeParse(
    sinkingFundsResult.data ?? [],
  );

  if (
    !fundsParseResult.success ||
    !categoriesParseResult.success ||
    !classesParseResult.success ||
    !sinkingFundsParseResult.success
  ) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Piano di accantonamento
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          I dati ricevuti non sono nel formato atteso. Contatta il supporto se
          il problema persiste.
        </p>
      </main>
    );
  }

  // 6. Compone l'albero
  const tree = buildSinkingFundTree(
    fundsParseResult.data,
    categoriesParseResult.data,
    classesParseResult.data,
    sinkingFundsParseResult.data,
  );

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-28">
      <div className="flex items-center justify-between">
        <span />
        <LogoutButton />
      </div>
      <SinkingFundTreeView tree={tree} />
    </main>
  );
}
