/**
 * GET  /api/accounts[?include_archived=true]
 * POST /api/accounts
 *
 * Minimal accounts endpoint for F6 bootstrap (Feature 6 — Transactions CRUD).
 * Full accounts CRUD (PUT/DELETE) is out of scope for F6.
 *
 * RLS: accounts_select_member / accounts_insert_member (household-scoped
 * via current_household_ids()). No admin client — service role bypasses RLS
 * and is not needed here.
 *
 * POST resolves household_id from household_members for auth.uid() (Strategy A
 * query + Strategy B RLS WITH CHECK defence). Same pattern as categories.POST
 * resolving from funds.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response schema — columns exposed by GRANT SELECT on accounts
// (grants.sql L53-55): id, household_id, name, bank, kind, scope,
// owner_user_id, currency, archived_at, created_at, updated_at
// Note: account_last4 is NOT in the SELECT grant.
// ---------------------------------------------------------------------------

const AccountRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["corrente", "fondi"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scope: z.enum(["family", "personal"]),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ---------------------------------------------------------------------------
// Request schema — POST body
// ---------------------------------------------------------------------------

const PostAccountBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["corrente", "fondi"]),
}).strict();

// ---------------------------------------------------------------------------
// GET /api/accounts[?include_archived=true]
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

  // 3. Parse query params
  const params = request.nextUrl.searchParams;
  const includeArchived = params.get("include_archived") === "true";

  // 4. Query accounts — RLS scopes to user's household automatically
  let query = supabase
    .from("accounts")
    .select(
      "id, household_id, name, kind, currency, scope, archived_at, created_at, updated_at",
    )
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data: rawRows, error: dbError } = await query;

  if (dbError) {
    console.error("[api/accounts] DB error fetching accounts", {
      userId,
      code: dbError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 5. Validate rows (drop malformed rows, same pattern as /api/classes)
  const accounts = (rawRows ?? []).flatMap((row) => {
    const result = AccountRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  return NextResponse.json(accounts, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/accounts
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

  const parsed = PostAccountBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { name, kind } = parsed.data;

  // 4. Resolve household_id from household_members for auth.uid().
  //    FdF assumes a single household per user post-signup; take the first row.
  //    RLS on household_members_select_member returns only rows for the
  //    authenticated user's household. If 0 rows → user has no household → 409.
  const { data: memberRows, error: memberError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .limit(1);

  if (memberError) {
    console.error("[api/accounts] DB error resolving household_members", {
      userId,
      code: memberError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  if (!memberRows || memberRows.length === 0) {
    return NextResponse.json(
      {
        error: "No household found for this user",
        code: "NO_HOUSEHOLD",
      },
      { status: 409 },
    );
  }

  const household_id = memberRows[0].household_id as string;

  // 5. Insert account — currency defaults to "EUR", scope defaults to "family".
  //    RLS WITH CHECK (accounts_insert_member) is the second defence layer.
  const { data: insertedRows, error: insertError } = await supabase
    .from("accounts")
    .insert({
      household_id,
      name,
      kind,
      currency: "EUR",
      scope: "family",
    })
    .select(
      "id, household_id, name, kind, currency, scope, archived_at, created_at, updated_at",
    );

  if (insertError) {
    // 23505 = unique_violation (UNIQUE(household_id, name))
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error: "Esiste già un conto con questo nome.",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[api/accounts] DB error inserting account", {
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
    console.error("[api/accounts] Insert succeeded but returned no row", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const rowResult = AccountRowSchema.safeParse(row);
  if (!rowResult.success) {
    console.error("[api/accounts] Inserted row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 201 });
}
