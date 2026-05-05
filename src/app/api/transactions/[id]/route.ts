/**
 * PUT    /api/transactions/:id
 * DELETE /api/transactions/:id  (hard delete — no archived_at on transactions)
 *
 * Item endpoint for a single Transaction.
 *
 * PUT accepts only the columns in GRANT UPDATE (grants.sql L135):
 *   class_id, description, needs_review.
 * amount_cents, booked_at, account_id, currency, source are immutable for
 * authenticated users. To "fix" an amount or date the user deletes and re-creates.
 *
 * DELETE is a hard delete — transactions table has no archived_at column.
 * RLS DELETE policy (transactions_delete_member) scopes to household.
 *
 * RLS: transactions_update_member / transactions_delete_member, both gated on
 * household_id IN (SELECT public.current_household_ids()). Cross-household
 * access silently returns no rows → 404 in all mutation paths.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { TransactionRowSchema } from "@/lib/domain/transactions";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request schema — PUT body
// ---------------------------------------------------------------------------

const PutTransactionBody = z
  .object({
    /** UUID or null (un-assign from class). */
    class_id: z.string().uuid().nullable().optional(),
    description: z.string().max(200).nullable().optional(),
    needs_review: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

// ---------------------------------------------------------------------------
// PUT /api/transactions/:id
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

  const transactionId = idResult.data;

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

  const parsed = PutTransactionBody.safeParse(body);
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

  // 5. If class_id is a non-null UUID, verify it belongs to the user's household.
  //    RLS on classes_select_member hides cross-household and non-existent rows.
  //    class_id === null means "un-assign" → no lookup needed.
  if (updates.class_id != null) {
    // Resolve the transaction's household_id first so we can cross-check.
    const { data: txRows, error: txError } = await supabase
      .from("transactions")
      .select("household_id")
      .eq("id", transactionId)
      .limit(1);

    if (txError) {
      console.error("[api/transactions/[id]] DB error resolving transaction household", {
        userId,
        code: txError.code,
      });
      return NextResponse.json(
        { error: "Database error", code: "DB_ERROR" },
        { status: 500 },
      );
    }

    // If the transaction itself is not found/hidden by RLS, the UPDATE below
    // will also return 0 rows → 404. Continue to the update step to keep the
    // 404 path unified.
    const txHouseholdId = txRows?.[0]?.household_id as string | undefined;

    if (txHouseholdId) {
      // Transaction visible — verify the target class belongs to the same household.
      const { data: classRows, error: classError } = await supabase
        .from("classes")
        .select("household_id")
        .eq("id", updates.class_id)
        .limit(1);

      if (classError) {
        console.error("[api/transactions/[id]] DB error resolving class for cross-household check", {
          userId,
          code: classError.code,
        });
        return NextResponse.json(
          { error: "Database error", code: "DB_ERROR" },
          { status: 500 },
        );
      }

      const classHouseholdId = classRows?.[0]?.household_id as string | undefined;
      if (!classRows || classRows.length === 0 || classHouseholdId !== txHouseholdId) {
        return NextResponse.json(
          {
            error: "Class does not belong to this household",
            code: "CROSS_HOUSEHOLD",
          },
          { status: 403 },
        );
      }
    }
  }

  // 6. Update transaction — build SET object from only the fields provided.
  //    Only columns in GRANT UPDATE are included: class_id, description, needs_review.
  //    RLS USING (transactions_update_member): row must be in user's household.
  //    RLS WITH CHECK: updated row must remain in user's household.
  //    Cross-household rows → RLS USING returns no match → data: [] → 404.
  const { data: updatedRows, error: updateError } = await supabase
    .from("transactions")
    .update(updates)
    .eq("id", transactionId)
    .select(
      "id, household_id, account_id, class_id, booked_at, amount_cents, currency, description, source, needs_review, created_at, updated_at",
    );

  if (updateError) {
    console.error("[api/transactions/[id]] DB error updating transaction", {
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
      { error: "Transaction not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const rowResult = TransactionRowSchema.safeParse(updatedRows[0]);
  if (!rowResult.success) {
    console.error("[api/transactions/[id]] Updated row failed schema validation", {
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
// DELETE /api/transactions/:id  (hard delete)
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

  const transactionId = idResult.data;

  // 4. Hard delete — use .delete().eq().select("id") to detect 0-row case.
  //    RLS DELETE policy (transactions_delete_member) scopes to user's household.
  //    Cross-household or non-existent rows → 0 rows deleted → 404.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId)
    .select("id");

  if (deleteError) {
    console.error("[api/transactions/[id]] DB error deleting transaction", {
      userId,
      code: deleteError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json(
      { error: "Transaction not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
