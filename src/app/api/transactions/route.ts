/**
 * GET  /api/transactions[?account_id=:uuid][&class_id=:uuid][&month=YYYY-MM][&limit=n]
 * POST /api/transactions
 *
 * Collection endpoint for transactions (Spesa/Entrata).
 * Schema sign convention (core_schema.sql L161):
 *   amount_cents < 0  →  outflow (spesa)
 *   amount_cents > 0  →  inflow  (entrata)
 *
 * RLS: transactions_select_member / transactions_insert_member (household-scoped
 * via current_household_ids()). No admin client.
 *
 * POST source is ALWAYS hardcoded to "manual" — never taken from client body.
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { TransactionRowSchema } from "@/lib/domain/transactions";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
/** Max days in the future allowed for booked_at (to cover scheduled charges). */
const MAX_FUTURE_DAYS = 7;

// ---------------------------------------------------------------------------
// Request schema — POST body
// ---------------------------------------------------------------------------

const PostTransactionBody = z
  .object({
    account_id: z.string().uuid(),
    class_id: z.string().uuid().optional(),
    /** ISO date "YYYY-MM-DD" */
    booked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "booked_at must be YYYY-MM-DD",
    }),
    /** Signed integer cents. Zero is rejected. */
    amount_cents: z
      .number()
      .int()
      .refine((n) => n !== 0, { message: "amount_cents must not be zero" }),
    description: z.string().max(200).optional(),
    /** 3-letter ISO 4217 uppercase currency code. Defaults to "EUR". */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, { message: "currency must be a 3-letter uppercase ISO code" })
      .default("EUR"),
  })
  .strict()
  .refine(
    (d) => {
      // Reject booked_at more than MAX_FUTURE_DAYS from today.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + MAX_FUTURE_DAYS);
      const booked = new Date(d.booked_at);
      return booked <= cutoff;
    },
    {
      message: `booked_at cannot be more than ${MAX_FUTURE_DAYS} days in the future`,
      path: ["booked_at"],
    },
  );

// ---------------------------------------------------------------------------
// GET /api/transactions
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

  // 3. Parse query params
  const params = request.nextUrl.searchParams;

  const rawAccountId = params.get("account_id");
  const rawClassId = params.get("class_id");
  const rawMonth = params.get("month");
  const rawLimit = params.get("limit");

  // Validate optional UUIDs
  if (rawAccountId !== null) {
    const r = z.string().uuid().safeParse(rawAccountId);
    if (!r.success) {
      return NextResponse.json(
        { error: "Invalid account_id: must be a UUID", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
  }
  if (rawClassId !== null) {
    const r = z.string().uuid().safeParse(rawClassId);
    if (!r.success) {
      return NextResponse.json(
        { error: "Invalid class_id: must be a UUID", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
  }

  // Validate month format
  if (rawMonth !== null) {
    const r = z.string().regex(/^\d{4}-\d{2}$/).safeParse(rawMonth);
    if (!r.success) {
      return NextResponse.json(
        { error: "Invalid month: must be YYYY-MM", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
  }

  // Parse limit: default 100, capped at 200
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "Invalid limit: must be a positive integer", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  // 4. Build query — RLS scopes to user's household automatically
  let query = supabase
    .from("transactions")
    .select(
      "id, household_id, account_id, class_id, booked_at, amount_cents, currency, description, source, needs_review, created_at, updated_at",
    )
    .order("booked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (rawAccountId) {
    query = query.eq("account_id", rawAccountId);
  }
  if (rawClassId) {
    query = query.eq("class_id", rawClassId);
  }
  if (rawMonth) {
    // Translate "YYYY-MM" to date range: [first_day_of_month, first_day_of_next_month)
    const [year, month] = rawMonth.split("-").map(Number);
    const firstDay = `${rawMonth}-01`;
    // Compute first day of next month
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    query = query.gte("booked_at", firstDay).lt("booked_at", nextMonthStr);
  }

  const { data: rawRows, error: dbError } = await query;

  if (dbError) {
    console.error("[api/transactions] DB error fetching transactions", {
      userId,
      code: dbError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 5. Validate rows with TransactionRowSchema (drop malformed rows)
  const transactions = (rawRows ?? []).flatMap((row) => {
    const result = TransactionRowSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });

  return NextResponse.json(transactions, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/transactions
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

  const parsed = PostTransactionBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Validation error",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  const { account_id, class_id, booked_at, amount_cents, description, currency } = parsed.data;

  // 4. Resolve household_id from account (Strategy A query + Strategy B RLS defence).
  //    RLS on accounts_select_member means this returns nothing if account_id
  //    belongs to a different household or does not exist → 404.
  const { data: accountRows, error: accountError } = await supabase
    .from("accounts")
    .select("household_id")
    .eq("id", account_id)
    .limit(1);

  if (accountError) {
    console.error("[api/transactions] DB error resolving account", {
      userId,
      code: accountError.code,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  if (!accountRows || accountRows.length === 0) {
    return NextResponse.json(
      { error: "Account not found", code: "ACCOUNT_NOT_FOUND" },
      { status: 404 },
    );
  }

  const household_id = accountRows[0].household_id as string;

  // 5. If class_id provided, verify it belongs to the same household.
  //    RLS on classes_select_member hides cross-household and non-existent rows.
  //    If lookup returns 0 rows → 403 CROSS_HOUSEHOLD (don't let INSERT WITH CHECK
  //    surface a 500 race).
  if (class_id) {
    const { data: classRows, error: classError } = await supabase
      .from("classes")
      .select("household_id")
      .eq("id", class_id)
      .limit(1);

    if (classError) {
      console.error("[api/transactions] DB error resolving class", {
        userId,
        code: classError.code,
      });
      return NextResponse.json(
        { error: "Database error", code: "DB_ERROR" },
        { status: 500 },
      );
    }

    const classHouseholdId = classRows?.[0]?.household_id as string | undefined;
    if (!classRows || classRows.length === 0 || classHouseholdId !== household_id) {
      return NextResponse.json(
        {
          error: "Class does not belong to this household",
          code: "CROSS_HOUSEHOLD",
        },
        { status: 403 },
      );
    }
  }

  // 6. Insert transaction — source hardcoded to "manual".
  //    RLS WITH CHECK (transactions_insert_member) is the second defence layer.
  const { data: insertedRows, error: insertError } = await supabase
    .from("transactions")
    .insert({
      household_id,
      account_id,
      ...(class_id !== undefined && { class_id }),
      booked_at,
      amount_cents,
      currency,
      ...(description !== undefined && { description }),
      source: "manual",
    })
    .select(
      "id, household_id, account_id, class_id, booked_at, amount_cents, currency, description, source, needs_review, created_at, updated_at",
    );

  if (insertError) {
    console.error("[api/transactions] DB error inserting transaction", {
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
    console.error("[api/transactions] Insert succeeded but returned no row", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  const rowResult = TransactionRowSchema.safeParse(row);
  if (!rowResult.success) {
    console.error("[api/transactions] Inserted row failed schema validation", {
      userId,
    });
    return NextResponse.json(
      { error: "Database error", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  return NextResponse.json(rowResult.data, { status: 201 });
}
