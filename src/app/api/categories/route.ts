/**
 * GET  /api/categories?fund_id=:uuid[&include_archived=true]
 * POST /api/categories
 *
 * Collection endpoint for categories (Categoria) within a Fund (Fondo).
 * Taxonomy: Fondo → Categoria → Classe (ADR-0006).
 *
 * RLS: categories_select_member / categories_insert_member (household-scoped
 * via current_household_ids()). No admin client — service role bypasses RLS
 * and is not needed here.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { CategoryRowSchema } from "@/lib/domain/funds";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request schema — POST body
// ---------------------------------------------------------------------------

const PostCategoryBody = z.object({
  fund_id: z.string().uuid(),
  name: z.string().trim().min(1),
  sort_order: z.number().int().optional().default(0),
  target_amount_cents: z.number().int().nullable().optional(),
  current_amount_cents: z.number().int().optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/categories?fund_id=:uuid[&include_archived=true]
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

  // 2. Verify authentication (getUser, not getSession)
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const userId = userData.user.id;

  // 3. Validate query params
  const params = request.nextUrl.searchParams;
  const rawFundId = params.get("fund_id");

  if (!rawFundId) {
    return NextResponse.json(
      { error: "Missing required param: fund_id", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const uuidResult = z.string().uuid().safeParse(rawFundId);
  if (!uuidResult.success) {
    return NextResponse.json(
      { error: "Invalid fund_id: must be a UUID", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const fundId = uuidResult.data;
  const includeArchived = params.get("include_archived") === "true";

  // 4. Query categories — RLS scopes to user's household automatically
  let query = supabase
    .from("categories")
    .select(
      "id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
    )
    .eq("fund_id", fundId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data: rawRows, error: dbError } = await query;

  if (dbError) {
    console.error("[api/categories] DB error fetching categories", {
      userId,
      code: dbError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 5. Validate rows (drop malformed rows, same pattern as /api/funds)
  const categories = (rawRows ?? []).flatMap((row) => {
    const result = CategoryRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  return NextResponse.json(categories, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/categories
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const parsed = PostCategoryBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { fund_id, name, sort_order, target_amount_cents, current_amount_cents } =
    parsed.data;

  // 4. Resolve household_id from fund (Strategy A query + Strategy B RLS defence).
  //    RLS on funds (funds_select_member) means this returns nothing if fund_id
  //    belongs to a different household or does not exist. Either case → 404.
  const { data: fundRows, error: fundError } = await supabase
    .from("funds")
    .select("household_id")
    .eq("id", fund_id)
    .limit(1);

  if (fundError) {
    console.error("[api/categories] DB error resolving fund", {
      userId,
      code: fundError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  if (!fundRows || fundRows.length === 0) {
    return NextResponse.json(
      { error: "Fund not found", code: "FUND_NOT_FOUND" },
      { status: 404 },
    );
  }

  const household_id = fundRows[0].household_id as string;

  // 5. Insert category — RLS WITH CHECK (categories_insert_member) is second
  //    defence layer against cross-household inserts.
  const { data: insertedRows, error: insertError } = await supabase
    .from("categories")
    .insert({
      household_id,
      fund_id,
      name,
      sort_order,
      ...(target_amount_cents !== undefined && { target_amount_cents }),
      current_amount_cents,
    })
    .select(
      "id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
    );

  if (insertError) {
    // 23505 = unique_violation (UNIQUE(fund_id, name))
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error: "A category with this name already exists in this fund",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[api/categories] DB error inserting category", {
      userId,
      code: insertError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const row = insertedRows?.[0];
  if (!row) {
    console.error("[api/categories] Insert succeeded but returned no row", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const rowResult = CategoryRowSchema.safeParse(row);
  if (!rowResult.success) {
    console.error("[api/categories] Inserted row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 201 });
}
