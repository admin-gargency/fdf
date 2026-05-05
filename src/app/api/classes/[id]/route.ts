/**
 * PUT    /api/classes/:id
 * DELETE /api/classes/:id  (soft delete — sets archived_at)
 *
 * Item endpoint for a single Class (Classe).
 * Taxonomy: Fondo → Categoria → Classe (ADR-0006).
 *
 * RLS: classes_update_member / classes_delete_member, both gated on
 * household_id IN (SELECT public.current_household_ids()). Cross-household
 * access silently returns no rows → 404 in all mutation paths.
 *
 * PUT accepts category_id to support reparenting a class to another category.
 * RLS UPDATE WITH CHECK (household_id IN current_household_ids()) prevents
 * cross-household reparenting at the DB level.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { ClassRowSchema } from "@/lib/domain/funds";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request schema — PUT body
// ---------------------------------------------------------------------------

const PutClassBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    category_id: z.string().uuid().optional(), // reparent; RLS WITH CHECK enforces cross-household isolation
    tipologia: z
      .enum(["addebito_immediato", "fondo_breve", "fondo_lungo"])
      .optional(),
    sort_order: z.number().int().optional(),
    archived_at: z.string().nullable().optional(), // allow un-archive via null
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

// ---------------------------------------------------------------------------
// PUT /api/classes/:id
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

  const classId = idResult.data;

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

  const parsed = PutClassBody.safeParse(body);
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

  // 5. If reparenting (category_id provided), verify the target category exists
  //    and belongs to the user's household via RLS on categories_select_member.
  //    The categories lookup is the access check; RLS UPDATE WITH CHECK is the
  //    second defence. household_id is NOT included in the UPDATE payload.
  if (updates.category_id) {
    const { data: categoryRows, error: categoryError } = await supabase
      .from("categories")
      .select("household_id")
      .eq("id", updates.category_id)
      .limit(1);

    if (categoryError) {
      console.error("[api/classes] DB error resolving category for reparent", {
        userId,
        code: categoryError.code,
      });
      return NextResponse.json(
        { error: "Database error", code: "DB_ERROR" },
        { status: 500 },
      );
    }

    if (!categoryRows || categoryRows.length === 0) {
      return NextResponse.json(
        { error: "Category not found", code: "CATEGORY_NOT_FOUND" },
        { status: 404 },
      );
    }
  }

  // 6. Update class — build SET object from only the fields provided.
  //    household_id is never included in the UPDATE payload.
  //    RLS USING (classes_update_member): row must be in user's household.
  //    RLS WITH CHECK: updated row must remain in user's household.
  //    Cross-household category_id reparenting → WITH CHECK rejects → data: [] → 404.
  //    UNIQUE(category_id, name) conflict → 23505 → 409.
  const { data: updatedRows, error: updateError } = await supabase
    .from("classes")
    .update(updates)
    .eq("id", classId)
    .select(
      "id, household_id, category_id, name, tipologia, sort_order, archived_at, created_at, updated_at",
    );

  if (updateError) {
    // 23505 = unique_violation (UNIQUE(category_id, name))
    if (updateError.code === "23505") {
      return NextResponse.json(
        {
          error: "A class with this name already exists in this category",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[api/classes] DB error updating class", {
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
      { error: "Class not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const rowResult = ClassRowSchema.safeParse(updatedRows[0]);
  if (!rowResult.success) {
    console.error("[api/classes] Updated row failed schema validation", {
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
// DELETE /api/classes/:id  (soft delete)
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

  const classId = idResult.data;

  // 4. Soft delete: set archived_at only when not already archived.
  //    RLS USING (classes_delete_member) scopes to user's household.
  //    archived_at IS NULL guard makes the operation idempotent:
  //    - Already-archived row: UPDATE matches 0 rows → we probe for existence.
  //    - Non-existent / cross-household row: same → probe resolves to 404.
  const { data: archivedRows, error: archiveError } = await supabase
    .from("classes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", classId)
    .is("archived_at", null)
    .select("id");

  if (archiveError) {
    console.error("[api/classes] DB error soft-deleting class", {
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
    .from("classes")
    .select("id")
    .eq("id", classId)
    .limit(1);

  if (probeError) {
    console.error("[api/classes] DB error probing class existence", {
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
    { error: "Class not found", code: "NOT_FOUND" },
    { status: 404 },
  );
}
