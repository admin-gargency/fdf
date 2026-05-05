/**
 * GET /api/sinking-funds-tree — Restituisce la gerarchia completa
 * Fondo → Categoria → Classe con i relativi sinking_funds associati
 * per l'household dell'utente autenticato.
 *
 * Feature 5 — Sinking-Fund-Tree Read View (FEATURE-5-BRIEF.md).
 * No query params, no filters dal client — RLS gestisce l'isolamento
 * per household via current_household_ids().
 *
 * RLS: funds_select_member, categories_select_member, classes_select_member,
 * sinking_funds_select_member. Nessun admin client — SSR client only.
 * Le colonne PII ungranted (sinking_funds.notes, ecc.) non sono selezionate.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  FundRowSchema,
  CategoryRowSchema,
  ClassRowSchema,
  SinkingFundRowSchema,
} from "@/lib/domain/funds";
import { buildSinkingFundTree } from "@/lib/domain/sinking-funds-tree";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // 1. Inizializza client SSR — nessun service role
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  // 2. Verifica autenticazione — usa getUser() (non getSession()) per sicurezza
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  // Log sicuro: solo user UUID, mai email o altri PII
  const userId = userData.user.id;

  // 3. Query 4 tabelle in parallelo — RLS filtra per household automaticamente
  //    archived_at IS NULL applicato esplicitamente su funds/categories/classes
  //    (non ci si affida solo a RLS per questo filtro).
  //    sinking_funds: no archived_at (non esiste sulla tabella).
  //    Colonne selezionate allineate ai GRANT SELECT (20260424000004_grants.sql).
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

      // sinking_funds: colonne esplicitamente allineate al GRANT SELECT L162-163.
      // `notes` deliberatamente escluso (PII, ungranted — vedi grants L159-160).
      supabase
        .from("sinking_funds")
        .select(
          "id, household_id, class_id, target_cents, target_date, monthly_contribution_cents, created_at, updated_at",
        ),
    ]);

  if (fundsResult.error) {
    console.error("[api/sinking-funds-tree] DB error fetching funds", {
      userId,
      code: fundsResult.error.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "QUERY_ERROR" },
      { status: 500 },
    );
  }

  if (categoriesResult.error) {
    console.error("[api/sinking-funds-tree] DB error fetching categories", {
      userId,
      code: categoriesResult.error.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "QUERY_ERROR" },
      { status: 500 },
    );
  }

  if (classesResult.error) {
    console.error("[api/sinking-funds-tree] DB error fetching classes", {
      userId,
      code: classesResult.error.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "QUERY_ERROR" },
      { status: 500 },
    );
  }

  if (sinkingFundsResult.error) {
    console.error("[api/sinking-funds-tree] DB error fetching sinking_funds", {
      userId,
      code: sinkingFundsResult.error.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "QUERY_ERROR" },
      { status: 500 },
    );
  }

  // 4. Valida ogni riga con Zod — errore di parse → 500 QUERY_ERROR con
  //    il messaggio ZodError per debugging (non espone PII: solo struttura schema).
  const fundsParseResult = FundRowSchema.array().safeParse(
    fundsResult.data ?? [],
  );
  if (!fundsParseResult.success) {
    console.error("[api/sinking-funds-tree] Zod parse error on funds", {
      userId,
    });
    return NextResponse.json(
      {
        error: fundsParseResult.error.message,
        code: "QUERY_ERROR",
      },
      { status: 500 },
    );
  }

  const categoriesParseResult = CategoryRowSchema.array().safeParse(
    categoriesResult.data ?? [],
  );
  if (!categoriesParseResult.success) {
    console.error("[api/sinking-funds-tree] Zod parse error on categories", {
      userId,
    });
    return NextResponse.json(
      {
        error: categoriesParseResult.error.message,
        code: "QUERY_ERROR",
      },
      { status: 500 },
    );
  }

  const classesParseResult = ClassRowSchema.array().safeParse(
    classesResult.data ?? [],
  );
  if (!classesParseResult.success) {
    console.error("[api/sinking-funds-tree] Zod parse error on classes", {
      userId,
    });
    return NextResponse.json(
      {
        error: classesParseResult.error.message,
        code: "QUERY_ERROR",
      },
      { status: 500 },
    );
  }

  const sinkingFundsParseResult = SinkingFundRowSchema.array().safeParse(
    sinkingFundsResult.data ?? [],
  );
  if (!sinkingFundsParseResult.success) {
    console.error(
      "[api/sinking-funds-tree] Zod parse error on sinking_funds",
      { userId },
    );
    return NextResponse.json(
      {
        error: sinkingFundsParseResult.error.message,
        code: "QUERY_ERROR",
      },
      { status: 500 },
    );
  }

  // 5. Compone l'albero e risponde
  const tree = buildSinkingFundTree(
    fundsParseResult.data,
    categoriesParseResult.data,
    classesParseResult.data,
    sinkingFundsParseResult.data,
  );

  return NextResponse.json({ tree }, { status: 200 });
}
