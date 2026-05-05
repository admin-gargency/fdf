/**
 * transactions.ts — Branded types, Zod schemas, and pure domain logic
 * for the transactions entity (Feature 6 — Transactions CRUD).
 *
 * Sign convention (mirrors core_schema.sql L161):
 *   amount_cents < 0  →  outflow (spesa)
 *   amount_cents > 0  →  inflow  (entrata)
 *
 * Ownership: domain-dev (AGENTS.md §File ownership convention).
 * Consumed by: src/app/api/transactions/route.ts, frontend-dev components
 *   (TransactionForm uses parseEuroToCents; TransactionList renders rows).
 *
 * NEVER include: raw_description, external_id, created_by — PII / ungranted
 * columns (grants.sql L9-12, L120-125).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-exports from funds.ts — avoid duplicating branded primitives
// ---------------------------------------------------------------------------

export type { Cents, AccountId, ClassId } from "./funds";

// ---------------------------------------------------------------------------
// Branded primitive — TransactionId
// ---------------------------------------------------------------------------

declare const _TransactionId: unique symbol;
/** Branded UUID for `public.transactions.id`. */
export type TransactionId = string & { readonly [_TransactionId]: void };

// ---------------------------------------------------------------------------
// TransactionRowSchema — aligned to GRANT SELECT columns only
// (grants.sql L123-125)
//
// Columns granted: id, household_id, account_id, class_id, booked_at,
//   amount_cents, currency, description, source, needs_review,
//   created_at, updated_at.
//
// Deliberately excluded: raw_description, external_id, created_by.
//
// Notes on types:
//   - booked_at: Postgres `date` serialised as "YYYY-MM-DD" string by
//     PostgREST/Supabase JS client.
//   - amount_cents: Postgres `bigint` serialised as number (within JS safe
//     integer range for realistic household amounts).
//   - source: closed enum matching the DB CHECK constraint (core_schema.sql L176).
// ---------------------------------------------------------------------------

export const TransactionRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  account_id: z.string().uuid(),
  /** Nullable — transaction may not be assigned to a Class. */
  class_id: z.string().uuid().nullable(),
  /** ISO date "YYYY-MM-DD" as returned by Supabase for Postgres `date`. */
  booked_at: z.string(),
  /** Signed integer: negative = outflow, positive = inflow. */
  amount_cents: z.number().int(),
  /** 3-letter ISO 4217 uppercase currency code. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().nullable(),
  source: z.enum(["manual", "psd2", "amex_pdf", "import_csv"]),
  needs_review: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** TypeScript type inferred from {@link TransactionRowSchema}. */
export type TransactionRow = z.infer<typeof TransactionRowSchema>;

// ---------------------------------------------------------------------------
// MonthlyTotalsSchema — output type of aggregateByMonth
// ---------------------------------------------------------------------------

export const MonthlyTotalsSchema = z.object({
  /** "YYYY-MM" */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Sum of amount_cents for rows where amount_cents > 0. Always >= 0. */
  inflow_cents: z.number().int(),
  /** Sum of amount_cents for rows where amount_cents < 0. Always <= 0. */
  outflow_cents: z.number().int(),
  /** inflow_cents + outflow_cents (signed net). */
  net_cents: z.number().int(),
  /** Number of transactions included in this month bucket. */
  count: z.number().int().nonnegative(),
});

/** TypeScript type inferred from {@link MonthlyTotalsSchema}. */
export type MonthlyTotals = z.infer<typeof MonthlyTotalsSchema>;

// ---------------------------------------------------------------------------
// aggregateByMonth — pure function, no I/O
// ---------------------------------------------------------------------------

/**
 * Groups `TransactionRow[]` by calendar month and computes inflow, outflow,
 * net, and count for each month.
 *
 * Sign convention:
 *   - `inflow_cents`  — sum of amount_cents where amount_cents > 0 (>= 0)
 *   - `outflow_cents` — sum of amount_cents where amount_cents < 0 (<= 0)
 *   - `net_cents`     — inflow_cents + outflow_cents (signed result)
 *
 * Output is sorted by `month` descending (most recent first).
 *
 * Rows with a malformed `booked_at` (cannot slice a valid "YYYY-MM" prefix)
 * are silently skipped — the function never throws.
 *
 * @param rows - Array of `TransactionRow` objects (may be empty).
 * @returns Array of `MonthlyTotals`, sorted month DESC. Empty input → [].
 */
export function aggregateByMonth(rows: TransactionRow[]): MonthlyTotals[] {
  type Accumulator = {
    inflow_cents: number;
    outflow_cents: number;
    count: number;
  };

  const buckets = new Map<string, Accumulator>();

  for (const row of rows) {
    // Defensive: booked_at must start with a "YYYY-MM" prefix (7 chars).
    const booked = row.booked_at;
    if (typeof booked !== "string" || booked.length < 7) {
      continue;
    }
    const month = booked.slice(0, 7);
    // Validate the sliced prefix looks like YYYY-MM (basic guard).
    if (!/^\d{4}-\d{2}$/.test(month)) {
      continue;
    }

    const existing = buckets.get(month);
    const cents = row.amount_cents;

    if (existing) {
      if (cents > 0) existing.inflow_cents += cents;
      else if (cents < 0) existing.outflow_cents += cents;
      existing.count += 1;
    } else {
      buckets.set(month, {
        inflow_cents: cents > 0 ? cents : 0,
        outflow_cents: cents < 0 ? cents : 0,
        count: 1,
      });
    }
  }

  // Convert map to array and sort month DESC.
  const result: MonthlyTotals[] = [];
  for (const [month, acc] of buckets) {
    result.push({
      month,
      inflow_cents: acc.inflow_cents,
      outflow_cents: acc.outflow_cents,
      net_cents: acc.inflow_cents + acc.outflow_cents,
      count: acc.count,
    });
  }

  result.sort((a, b) => b.month.localeCompare(a.month));
  return result;
}

// ---------------------------------------------------------------------------
// parseEuroToCents — pure function, no I/O
// ---------------------------------------------------------------------------

/**
 * Parses a user-entered euro amount string into absolute integer cents.
 *
 * Accepted formats (case-insensitive leading €, optional surrounding whitespace):
 *   - "12,50"       → 1250
 *   - "12.50"       → 1250
 *   - "12,5"        → 1250   (single decimal digit, padded)
 *   - "100"         → 10000  (no decimals)
 *   - "100,00"      → 10000
 *   - "1.234,56"    → 123456 (Italian thousands separator: dot, decimal: comma)
 *   - "€ 12,50"     → 1250
 *   - "€12,50"      → 1250
 *
 * Rejection rules (returns `null`):
 *   - More than 2 decimal digits (e.g. "12,555")
 *   - Non-numeric characters after stripping € and whitespace
 *   - Empty string or whitespace-only
 *   - Result is 0 (zero-value not meaningful for a transaction)
 *   - Negative inputs (e.g. "-12") — sign is applied by the caller via
 *     the `kind` toggle (spesa / entrata)
 *
 * The function returns the **absolute** value in integer cents. The caller
 * is responsible for negating the result for outflow transactions.
 *
 * @param input - Raw string from user input field.
 * @returns Absolute cents as integer, or `null` on invalid/zero input.
 */
export function parseEuroToCents(input: string): number | null {
  if (typeof input !== "string") return null;

  // Trim surrounding whitespace and strip optional leading €.
  let s = input.trim();
  if (s === "") return null;

  // Strip optional leading € (with optional following whitespace).
  if (s.startsWith("€")) {
    s = s.slice(1).trim();
  }
  if (s === "") return null;

  // Reject negative sign — caller applies sign separately.
  if (s.startsWith("-")) return null;

  // Detect Italian thousands format: digit(s), then one or more groups of
  // ".ddd", then optionally ",dd" decimal.
  // e.g. "1.234,56" or "1.234" (no decimal).
  const italianThousands = /^(\d{1,3})(\.\d{3})+(?:,(\d{1,2}))?$/.exec(s);
  if (italianThousands) {
    // Remove thousand separators (dots), replace comma decimal with dot.
    const integerPart = s.replace(/\./g, "").replace(",", ".");
    const parsed = parseFloat(integerPart);
    if (!isFinite(parsed)) return null;
    const cents = Math.round(parsed * 100);
    return cents === 0 ? null : cents;
  }

  // Plain format: optional integer part, optional separator (comma or dot),
  // optional decimal (1 or 2 digits). Reject more than 2 decimal digits.
  //
  // Valid: "12,50" "12.50" "12,5" "100" "100,00"
  // Invalid: "12,555" "abc" "12.3.4"
  const plain = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(s);
  if (!plain) return null;

  const intPart = parseInt(plain[1], 10);
  const decStr = plain[2] ?? "00";
  // Pad single decimal digit to 2 places ("12,5" → "50" not "05").
  const decPadded = decStr.length === 1 ? decStr + "0" : decStr;
  const decPart = parseInt(decPadded, 10);

  const cents = intPart * 100 + decPart;
  return cents === 0 ? null : cents;
}
