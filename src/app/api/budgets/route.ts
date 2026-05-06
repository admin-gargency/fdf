/**
 * GET  /api/budgets[?period=YYYY-MM]
 * POST /api/budgets  (upsert — 201 always, see OQ-1 resolution in FDFA-55)
 *
 * Collection endpoint for Budgets (monthly amount per Classe).
 * Taxonomy: Fondo → Categoria → Classe → Budget (ADR-0006).
 *
 * Schema facts (core_schema.sql L206-222):
 *   - `period` is a Postgres `date` locked to first-of-month
 *     (CHECK: period = date_trunc('month', period)::date).
 *   - UNIQUE constraint: (class_id, period) — household isolation is
 *     guaranteed transitively because class_id FK → classes.household_id.
 *   - GRANT UPDATE: only `amount_cents` (grants.sql L152). PUT on [id]
 *     is therefore restricted to that column only.
 *
 * POST upsert rationale (OQ-1 decision, approved by Antonio/CEO):
 *   Returns 201 always. Discriminating INSERT vs UPDATE would require a
 *   raw SQL RPC (new migration, ASK-gated) or a pre-read probe (TOCTOU
 *   window). The endpoint is idempotent by contract: callers must not
 *   branch on 201 vs 200.
 *
 * RLS: budgets_select_member / budgets_insert_member (household-scoped
 * via current_household_ids()). No admin client — RLS is clean (no
 * bootstrap recursion like the F2 households bug).
 *
 * Household derivation for POST follows the two-layer Strategy A+B
 * pattern (POST-MORTEM-FEATURES-3-4.md §2):
 *   A. Query `classes` for `household_id` using the user-supplied
 *      `class_id` — RLS hides cross-household/non-existent rows → 404.
 *   B. Upsert WITH CHECK (budgets_insert_member) is the second defence.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  BudgetRowSchema,
  BudgetCreateInputSchema,
  normalisePeriod,
} from "@/lib/domain/budgets";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/budgets[?period=YYYY-MM]
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  // 3. Validate optional `period` query param
  const rawPeriod = request.nextUrl.searchParams.get("period");

  if (rawPeriod !== null) {
    const periodResult = z
      .string()
      .regex(/^\d{4}-\d{2}$/, { message: "period must be YYYY-MM" })
      .safeParse(rawPeriod);
    if (!periodResult.success) {
      return NextResponse.json(
        { error: "Invalid period: must be YYYY-MM", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
  }

  // 4. Build query — RLS (budgets_select_member) scopes to user's household.
  //    If `period` is provided, translate "YYYY-MM" to the date range
  //    [YYYY-MM-01, first-day-of-next-month) — same pattern as transactions.
  let query = supabase
    .from("budgets")
    .select(
      "id, household_id, class_id, period, amount_cents, created_at, updated_at",
    )
    .order("period", { ascending: false })
    .order("created_at", { ascending: false });

  if (rawPeriod !== null) {
    const [year, month] = rawPeriod.split("-").map(Number);
    const firstDay = `${rawPeriod}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    query = query.gte("period", firstDay).lt("period", nextMonthStr);
  }

  const { data: rawRows, error: dbError } = await query;

  if (dbError) {
    console.error("[api/budgets] DB error fetching budgets", {
      userId,
      code: dbError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "FETCH_ERROR" },
      { status: 500 },
    );
  }

  // 5. Validate rows with BudgetRowSchema (drop malformed rows silently)
  const budgets = (rawRows ?? []).flatMap((row) => {
    const result = BudgetRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  // Returns array directly — no envelope (OQ-3 decision: consistent with
  // transactions/route.ts which also returns the array directly).
  return NextResponse.json(budgets, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/budgets  (upsert)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // 3. Parse and validate request body
  //    Uses domain BudgetCreateInputSchema directly — keeps API body schema
  //    in sync with domain without duplication.
  //    .strict() not called here because BudgetCreateInputSchema is already
  //    a closed object (no extra fields accepted by Zod by default).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  // Wrap with .strict() at the call site to reject extra fields.
  const parsed = BudgetCreateInputSchema.strict().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { class_id, period, amount_cents } = parsed.data;

  // 4. Normalise period "YYYY-MM" → "YYYY-MM-01" before insert.
  //    Uses domain helper — satisfies DB CHECK constraint on `period`.
  const normalisedPeriod = normalisePeriod(period);

  // 5. Resolve household_id from class record (Strategy A).
  //    RLS classes_select_member: USING (household_id IN current_household_ids()).
  //    Cross-household or non-existent class_id → 0 rows → 404 CLASS_NOT_FOUND.
  //    Server derives household_id; client never supplies it directly.
  const { data: classRows, error: classError } = await supabase
    .from("classes")
    .select("household_id")
    .eq("id", class_id)
    .limit(1);

  if (classError) {
    console.error("[api/budgets] DB error resolving class", {
      userId,
      code: classError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "INSERT_ERROR" },
      { status: 500 },
    );
  }

  if (!classRows || classRows.length === 0) {
    return NextResponse.json(
      { error: "Class not found", code: "CLASS_NOT_FOUND" },
      { status: 404 },
    );
  }

  const household_id = classRows[0].household_id as string;

  // 6. Upsert budget.
  //    ON CONFLICT (class_id, period) DO UPDATE SET amount_cents = EXCLUDED.amount_cents.
  //    RLS budgets_insert_member WITH CHECK (household_id IN current_household_ids())
  //    is Strategy B — second defence layer.
  //    Returns 201 always (OQ-1 decision: approved by Antonio/CEO).
  const { data: upsertedRows, error: upsertError } = await supabase
    .from("budgets")
    .upsert(
      { household_id, class_id, period: normalisedPeriod, amount_cents },
      { onConflict: "class_id,period" },
    )
    .select(
      "id, household_id, class_id, period, amount_cents, created_at, updated_at",
    );

  if (upsertError) {
    console.error("[api/budgets] DB error upserting budget", {
      userId,
      code: upsertError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "INSERT_ERROR" },
      { status: 500 },
    );
  }

  const row = upsertedRows?.[0];
  if (!row) {
    console.error("[api/budgets] Upsert succeeded but returned no row", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "INSERT_ERROR" },
      { status: 500 },
    );
  }

  // 7. Validate returned row against BudgetRowSchema
  const rowResult = BudgetRowSchema.safeParse(row);
  if (!rowResult.success) {
    console.error("[api/budgets] Upserted row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "INSERT_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 201 });
}
