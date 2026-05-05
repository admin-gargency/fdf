/**
 * PUT    /api/categories/:id
 * DELETE /api/categories/:id  (soft delete — sets archived_at)
 *
 * Item endpoint for a single Category (Categoria).
 * Taxonomy: Fondo → Categoria → Classe (ADR-0006).
 *
 * RLS: categories_update_member / categories_delete_member, both gated on
 * household_id IN (SELECT public.current_household_ids()). Cross-household
 * access silently returns no rows → 404 in all mutation paths.
 *
 * PUT accepts fund_id to support reparenting a category to another fund.
 * RLS UPDATE WITH CHECK (household_id IN current_household_ids()) prevents
 * cross-household reparenting at the DB level.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { CategoryRowSchema } from "@/lib/domain/funds";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request schema — PUT body
// ---------------------------------------------------------------------------

const PutCategoryBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    fund_id: z.string().uuid().optional(), // reparent; RLS WITH CHECK enforces cross-household isolation
    sort_order: z.number().int().optional(),
    target_amount_cents: z.number().int().nullable().optional(),
    current_amount_cents: z.number().int().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

// ---------------------------------------------------------------------------
// PUT /api/categories/:id
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

  const categoryId = idResult.data;

  // 4. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const parsed = PutCategoryBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const updates = parsed.data;

  // 5. Update category — build SET object from only the fields provided.
  //    RLS USING (categories_update_member): row must be in user's household.
  //    RLS WITH CHECK: updated row must remain in user's household.
  //    Cross-household fund_id reparenting → WITH CHECK rejects → data: [] → 404.
  //    UNIQUE(fund_id, name) conflict → 23505 → 409.
  const { data: updatedRows, error: updateError } = await supabase
    .from("categories")
    .update(updates)
    .eq("id", categoryId)
    .select(
      "id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents, created_at, updated_at",
    );

  if (updateError) {
    // 23505 = unique_violation (UNIQUE(fund_id, name))
    if (updateError.code === "23505") {
      return NextResponse.json(
        {
          error: "A category with this name already exists in this fund",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[api/categories] DB error updating category", {
      userId,
      code: updateError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "Category not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const rowResult = CategoryRowSchema.safeParse(updatedRows[0]);
  if (!rowResult.success) {
    console.error("[api/categories] Updated row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE /api/categories/:id  (soft delete)
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

  const categoryId = idResult.data;

  // 4. Soft delete: set archived_at only when not already archived.
  //    RLS USING (categories_delete_member) scopes to user's household.
  //    archived_at IS NULL guard makes the operation idempotent:
  //    - Already-archived row: UPDATE matches 0 rows → we probe for existence.
  //    - Non-existent / cross-household row: same → probe resolves to 404.
  const { data: archivedRows, error: archiveError } = await supabase
    .from("categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", categoryId)
    .is("archived_at", null)
    .select("id");

  if (archiveError) {
    console.error("[api/categories] DB error soft-deleting category", {
      userId,
      code: archiveError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // Soft delete succeeded — row was active and is now archived.
  if (archivedRows && archivedRows.length > 0) {
    return new NextResponse(null, { status: 204 });
  }

  // 5. No rows affected — probe to distinguish already-archived from not-found.
  const { data: probeRows, error: probeError } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .limit(1);

  if (probeError) {
    console.error("[api/categories] DB error probing category existence", {
      userId,
      code: probeError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // Row exists but was already archived → idempotent 204.
  if (probeRows && probeRows.length > 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Row not found or belongs to another household (RLS hides it) → 404.
  return NextResponse.json(
    { error: "Category not found", code: "NOT_FOUND" },
    { status: 404 },
  );
}
