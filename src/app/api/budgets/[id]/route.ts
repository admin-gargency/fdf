/**
 * PUT    /api/budgets/:id
 * DELETE /api/budgets/:id  (hard delete — no archived_at on budgets)
 *
 * Item endpoint for a single Budget row.
 * Taxonomy: Fondo → Categoria → Classe → Budget (ADR-0006).
 *
 * PUT constraints (grants.sql L152):
 *   GRANT UPDATE (amount_cents) — only `amount_cents` is mutable.
 *   `class_id` and `period` are immutable after creation (the UNIQUE
 *   constraint on (class_id, period) encodes this semantically).
 *
 * DELETE is a hard delete — budgets have no `archived_at` column.
 *   RLS DELETE policy (budgets_delete_member) scopes to user's household.
 *
 * RLS on both mutations uses USING + WITH CHECK on
 *   household_id IN (SELECT public.current_household_ids()).
 * Cross-household or non-existent budget IDs → 0 rows → 404 NOT_FOUND.
 * No admin client, no pre-check needed — household_id is fixed at upsert
 * time and the budget's class FK already guarantees household alignment.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { BudgetRowSchema, BudgetUpdateInputSchema } from "@/lib/domain/budgets";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// PUT /api/budgets/:id
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Init SSR client
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  // 2. Verify authentication
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const userId = userData.user.id;

  // 3. Validate route param :id
  const { id } = await params;
  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "Invalid id: must be a UUID", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const budgetId = idResult.data;

  // 4. Parse and validate request body.
  //    Only amount_cents is accepted — class_id and period are immutable.
  //    .strict() rejects any extra fields (e.g., client trying to change
  //    class_id or period) with VALIDATION_ERROR before the DB sees them.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const parsed = BudgetUpdateInputSchema.strict().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { amount_cents } = parsed.data;

  // 5. Update budget — only amount_cents (the only GRANT UPDATE column).
  //    RLS USING (budgets_update_member): row must be in user's household.
  //    RLS WITH CHECK: updated row must remain in user's household.
  //    Cross-household or non-existent id → 0 rows → 404 NOT_FOUND.
  const { data: updatedRows, error: updateError } = await supabase
    .from("budgets")
    .update({ amount_cents })
    .eq("id", budgetId)
    .select(
      "id, household_id, class_id, period, amount_cents, created_at, updated_at",
    );

  if (updateError) {
    console.error("[api/budgets/[id]] DB error updating budget", {
      userId,
      code: updateError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "UPDATE_ERROR" },
      { status: 500 },
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "Budget not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  // 6. Validate returned row against BudgetRowSchema
  const rowResult = BudgetRowSchema.safeParse(updatedRows[0]);
  if (!rowResult.success) {
    console.error("[api/budgets/[id]] Updated row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "UPDATE_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE /api/budgets/:id  (hard delete)
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Init SSR client
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  // 2. Verify authentication
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const userId = userData.user.id;

  // 3. Validate route param :id
  const { id } = await params;
  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "Invalid id: must be a UUID", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const budgetId = idResult.data;

  // 4. Hard delete — use .select("id") to detect 0-row case.
  //    RLS DELETE policy (budgets_delete_member) scopes to user's household.
  //    Cross-household or non-existent budget → 0 rows deleted → 404.
  //    No soft-delete probe needed: hard delete is not idempotent, and
  //    returning 404 on a second call is the correct semantics.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("budgets")
    .delete()
    .eq("id", budgetId)
    .select("id");

  if (deleteError) {
    console.error("[api/budgets/[id]] DB error deleting budget", {
      userId,
      code: deleteError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DELETE_ERROR" },
      { status: 500 },
    );
  }

  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json(
      { error: "Budget not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
