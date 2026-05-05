/**
 * GET  /api/classes?category_id=:uuid[&include_archived=true]
 * POST /api/classes
 *
 * Collection endpoint for classes (Classe) within a Category (Categoria).
 * Taxonomy: Fondo → Categoria → Classe (ADR-0006).
 *
 * RLS: classes_select_member / classes_insert_member (household-scoped
 * via current_household_ids()). No admin client — service role bypasses RLS
 * and is not needed here.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { ClassRowSchema } from "@/lib/domain/funds";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request schema — POST body
// ---------------------------------------------------------------------------

const PostClassBody = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1),
  tipologia: z.enum(["addebito_immediato", "fondo_breve", "fondo_lungo"]),
  sort_order: z.number().int().optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/classes?category_id=:uuid[&include_archived=true]
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
  const rawCategoryId = params.get("category_id");

  if (!rawCategoryId) {
    return NextResponse.json(
      {
        error: "Missing required param: category_id",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const uuidResult = z.string().uuid().safeParse(rawCategoryId);
  if (!uuidResult.success) {
    return NextResponse.json(
      {
        error: "Invalid category_id: must be a UUID",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const categoryId = uuidResult.data;
  const includeArchived = params.get("include_archived") === "true";

  // 4. Query classes — RLS scopes to user's household automatically
  let query = supabase
    .from("classes")
    .select(
      "id, household_id, category_id, name, tipologia, sort_order, archived_at, created_at, updated_at",
    )
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data: rawRows, error: dbError } = await query;

  if (dbError) {
    console.error("[api/classes] DB error fetching classes", {
      userId,
      code: dbError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 5. Validate rows (drop malformed rows, same pattern as /api/categories)
  const classes = (rawRows ?? []).flatMap((row) => {
    const result = ClassRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  return NextResponse.json(classes, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/classes
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

  const parsed = PostClassBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { category_id, name, tipologia, sort_order } = parsed.data;

  // 4. Resolve household_id from category (Strategy A query + Strategy B RLS defence).
  //    RLS on categories (categories_select_member) means this returns nothing if
  //    category_id belongs to a different household or does not exist. Either case → 404.
  const { data: categoryRows, error: categoryError } = await supabase
    .from("categories")
    .select("household_id")
    .eq("id", category_id)
    .limit(1);

  if (categoryError) {
    console.error("[api/classes] DB error resolving category", {
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

  const household_id = categoryRows[0].household_id as string;

  // 5. Insert class — RLS WITH CHECK (classes_insert_member) is second
  //    defence layer against cross-household inserts.
  const { data: insertedRows, error: insertError } = await supabase
    .from("classes")
    .insert({
      household_id,
      category_id,
      name,
      tipologia,
      sort_order,
    })
    .select(
      "id, household_id, category_id, name, tipologia, sort_order, archived_at, created_at, updated_at",
    );

  if (insertError) {
    // 23505 = unique_violation (UNIQUE(category_id, name))
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error: "A class with this name already exists in this category",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[api/classes] DB error inserting class", {
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
    console.error("[api/classes] Insert succeeded but returned no row", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const rowResult = ClassRowSchema.safeParse(row);
  if (!rowResult.success) {
    console.error("[api/classes] Inserted row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 201 });
}
