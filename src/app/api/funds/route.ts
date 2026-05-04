/**
 * GET /api/funds — Restituisce il fund tree (Fondo → Categoria → Classe)
 * per l'household dell'utente autenticato.
 *
 * RLS garantisce che ogni query ritorni solo le righe dell'household
 * raggiungibile dall'utente corrente (via current_household_ids()).
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildFundTree,
  FundRowSchema,
  CategoryRowSchema,
  ClassRowSchema,
} from "@/lib/domain/funds";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // 1. Inizializza client SSR
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

  // 3. Query funds (solo attivi, ordinati)
  const { data: rawFunds, error: fundsError } = await supabase
    .from("funds")
    .select(
      "id, household_id, default_account_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
    )
    .is("archived_at", null)
    .order("sort_order");

  if (fundsError) {
    console.error("[api/funds] DB error fetching funds", {
      userId,
      code: fundsError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 4. Query categories (solo attive, ordinate)
  const { data: rawCategories, error: categoriesError } = await supabase
    .from("categories")
    .select(
      "id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
    )
    .is("archived_at", null)
    .order("sort_order");

  if (categoriesError) {
    console.error("[api/funds] DB error fetching categories", {
      userId,
      code: categoriesError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 5. Query classes (solo attive, ordinate) — nessun campo importo su classes
  const { data: rawClasses, error: classesError } = await supabase
    .from("classes")
    .select(
      "id, household_id, category_id, name, tipologia, sort_order, archived_at, created_at, updated_at",
    )
    .is("archived_at", null)
    .order("sort_order");

  if (classesError) {
    console.error("[api/funds] DB error fetching classes", {
      userId,
      code: classesError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 6. Valida le righe con Zod (parse sicuro: righe invalide vengono scartate)
  const funds = (rawFunds ?? []).flatMap((row) => {
    const result = FundRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  const categories = (rawCategories ?? []).flatMap((row) => {
    const result = CategoryRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  const classes = (rawClasses ?? []).flatMap((row) => {
    const result = ClassRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  // 7. Compone il tree e risponde
  const tree = buildFundTree(funds, categories, classes);

  return NextResponse.json(tree, { status: 200 });
}
