/**
 * budgets.ts — Branded types, Zod schemas, and pure domain logic
 * for the budgets entity (Feature 7 — Budgets CRUD + Monthly Planning).
 *
 * DB table: public.budgets (core_schema.sql L206-222)
 *   - `period` is stored as a Postgres `date` locked to YYYY-MM-01
 *     (enforced by CHECK: period = date_trunc('month', period)::date).
 *   - `amount_cents` is Postgres `bigint NOT NULL CHECK (amount_cents >= 0)`.
 *     Supabase JS client serialises Postgres bigint as JS `number` (within
 *     safe integer range for realistic household amounts) — matching the
 *     convention in transactions.ts.
 *
 * Sign convention for actual spending (mirrors transactions.ts L6-7):
 *   amount_cents < 0  →  outflow (spesa)
 *   amount_cents > 0  →  inflow  (entrata)
 *
 * Ownership: domain-dev (AGENTS.md §File ownership convention).
 * Consumed by: src/app/api/budgets/route.ts (backend-dev),
 *   frontend-dev components (read-only).
 *
 * NEVER include: side-effects, DB calls, Next.js imports.
 */

import { z } from "zod";
import type { TransactionRow } from "./transactions";

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

declare const _BudgetId: unique symbol;
/** Branded UUID for `public.budgets.id`. */
export type BudgetId = string & { readonly [_BudgetId]: void };

// ---------------------------------------------------------------------------
// BudgetRowSchema — aligned 1:1 with DB columns
//
// Postgres types → JS serialisation (Supabase client):
//   uuid        → string
//   date        → "YYYY-MM-DD" string
//   bigint      → number (JS safe integer — see module header note)
//   timestamptz → ISO datetime string
// ---------------------------------------------------------------------------

/**
 * Zod schema for a row returned by `SELECT * FROM public.budgets`.
 *
 * `period` is always the first day of the month ("YYYY-MM-01") as enforced
 * by the DB CHECK constraint. The regex below validates this invariant at
 * the domain boundary.
 */
export const BudgetRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  class_id: z.string().uuid(),
  /** Postgres `date` serialised as "YYYY-MM-DD". Always first-of-month. */
  period: z.string().regex(/^\d{4}-\d{2}-01$/),
  /** Non-negative integer in cents. Postgres `bigint`, JS `number`. */
  amount_cents: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** TypeScript type inferred from {@link BudgetRowSchema}. */
export type Budget = z.infer<typeof BudgetRowSchema>;

// ---------------------------------------------------------------------------
// BudgetCreateInputSchema — client → API create payload
//
// The client supplies `period` as "YYYY-MM" (user-facing month picker).
// The API server normalises it to "YYYY-MM-01" before writing to Postgres.
// ---------------------------------------------------------------------------

export const BudgetCreateInputSchema = z.object({
  class_id: z.string().uuid(),
  /** "YYYY-MM" — server normalises to "YYYY-MM-01". */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  /** Non-negative integer in cents. */
  amount_cents: z.number().int().nonnegative(),
});

/** TypeScript type inferred from {@link BudgetCreateInputSchema}. */
export type BudgetCreateInput = z.infer<typeof BudgetCreateInputSchema>;

// ---------------------------------------------------------------------------
// BudgetUpdateInputSchema — client → API update payload
//
// `class_id` and `period` are immutable (DB UNIQUE constraint on
// (class_id, period)). Only `amount_cents` can be patched.
// ---------------------------------------------------------------------------

export const BudgetUpdateInputSchema = z.object({
  /** Non-negative integer in cents. */
  amount_cents: z.number().int().nonnegative(),
});

/** TypeScript type inferred from {@link BudgetUpdateInputSchema}. */
export type BudgetUpdateInput = z.infer<typeof BudgetUpdateInputSchema>;

// ---------------------------------------------------------------------------
// BudgetSummary — output type of calculateBudgetVsActual
// ---------------------------------------------------------------------------

/**
 * Comparison of a budgeted amount against actual spending for one Class
 * within a given month period.
 *
 * All monetary fields are in integer cents (JS `number`).
 */
export interface BudgetSummary {
  class_id: string;
  /**
   * Optional display name — populated by the API/UI layer via join on
   * `classes.name`. The pure domain function does not fetch names.
   */
  class_name?: string;
  /** Budgeted amount for the period in cents (non-negative). */
  budget_cents: number;
  /**
   * Sum of absolute outflow amounts for this class in the period.
   * Derived from transactions where amount_cents < 0 (spese).
   * Always >= 0.
   */
  actual_cents: number;
  /**
   * budget_cents - actual_cents.
   * Positive  → under budget (remaining headroom).
   * Negative  → over budget (exceeded).
   */
  delta_cents: number;
  /**
   * (actual_cents / budget_cents) * 100, rounded to one decimal place.
   *
   * Zero-budget edge case: if budget_cents === 0 and actual_cents === 0,
   * progress_pct is 0. If budget_cents === 0 but actual_cents > 0, we
   * cannot compute a meaningful percentage — progress_pct is set to 100
   * (fully "consumed") and delta_cents is -actual_cents (all overspent).
   * This avoids a divide-by-zero and signals to the UI that the class is
   * over its (zero) budget.
   */
  progress_pct: number;
}

// ---------------------------------------------------------------------------
// normalisePeriod — pure helper
// ---------------------------------------------------------------------------

/**
 * Normalises a period string from "YYYY-MM" (create-input format) to the
 * "YYYY-MM-01" format stored in Postgres. Idempotent on "YYYY-MM-DD" strings.
 *
 * Useful for server-side normalisation before INSERT.
 *
 * @param period - "YYYY-MM" or "YYYY-MM-DD" string.
 * @returns "YYYY-MM-01" string.
 */
export function normalisePeriod(period: string): string {
  // Already in "YYYY-MM-DD" form (BudgetRowSchema regex guarantees "-01" suffix
  // from DB, but accept any full date and replace the day part).
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return period.slice(0, 7) + "-01";
  }
  // "YYYY-MM" form from BudgetCreateInputSchema.
  return period + "-01";
}

// ---------------------------------------------------------------------------
// calculateBudgetVsActual — pure function, no I/O
// ---------------------------------------------------------------------------

/**
 * Compares budgeted amounts against actual outflow transactions for a given
 * calendar month.
 *
 * ## What counts as "actual" spending
 * Only transactions where:
 *   1. `class_id` matches a budgeted class.
 *   2. `booked_at` falls within the same calendar month as `period`.
 *   3. `amount_cents < 0` (outflows / spese). Inflows are ignored.
 *
 * `actual_cents` is the **absolute** sum of those outflow amounts (always >= 0).
 *
 * ## Classes without a budget
 * This function operates only on the provided `budgets[]`. Classes that have
 * transactions but no budget entry are not included in the output — the caller
 * (API layer) can decide whether to surface unbudgeted spending separately.
 *
 * ## Zero-budget edge case
 * If `budget_cents === 0` and `actual_cents === 0`: `progress_pct = 0`.
 * If `budget_cents === 0` and `actual_cents > 0`: `progress_pct = 100`,
 * `delta_cents = -actual_cents`. See {@link BudgetSummary.progress_pct} JSDoc.
 *
 * @param budgets      - Budget rows for any set of classes (pre-filtered or not).
 * @param transactions - Transaction rows (may span multiple months).
 * @param period       - Target month in "YYYY-MM" or "YYYY-MM-01" format.
 * @returns One {@link BudgetSummary} per budget row, in input order.
 */
export function calculateBudgetVsActual(
  budgets: Budget[],
  transactions: TransactionRow[],
  period: string,
): BudgetSummary[] {
  // Normalise period to "YYYY-MM" prefix for booked_at comparison.
  const monthPrefix = period.slice(0, 7); // "YYYY-MM"

  // Pre-compute: sum absolute outflows per class_id for the target month.
  // We iterate transactions once and bucket by class_id.
  const actualByClass = new Map<string, number>();

  for (const tx of transactions) {
    // Skip unclassified transactions.
    if (tx.class_id === null) continue;
    // Skip transactions outside the target month.
    if (!tx.booked_at.startsWith(monthPrefix)) continue;
    // Skip inflows and zero-amount entries — only outflows count.
    if (tx.amount_cents >= 0) continue;

    const prev = actualByClass.get(tx.class_id) ?? 0;
    // amount_cents is negative for outflows; negate to get absolute value.
    actualByClass.set(tx.class_id, prev + Math.abs(tx.amount_cents));
  }

  // Build BudgetSummary for each budget entry.
  return budgets.map((budget): BudgetSummary => {
    const actual_cents = actualByClass.get(budget.class_id) ?? 0;
    const budget_cents = budget.amount_cents;
    const delta_cents = budget_cents - actual_cents;

    let progress_pct: number;
    if (budget_cents === 0) {
      // Zero-budget edge case: avoid divide-by-zero.
      // If actual is also zero, nothing spent → 0 %. Otherwise cap at 100 %
      // to signal the class is fully over its (zero) budget.
      progress_pct = actual_cents === 0 ? 0 : 100;
    } else {
      progress_pct = Math.round((actual_cents / budget_cents) * 1000) / 10;
    }

    return {
      class_id: budget.class_id,
      budget_cents,
      actual_cents,
      delta_cents,
      progress_pct,
    };
  });
}
