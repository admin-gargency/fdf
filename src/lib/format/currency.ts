/**
 * currency.ts — Pure formatting helpers for monetary amounts.
 *
 * Ownership: frontend-dev (Feature 5, FEATURE-5-BRIEF.md §"Frontend").
 * Consumed by: src/components/sinking-funds-tree/**
 *
 * All helpers are pure functions with no side effects.
 * Currency amounts are stored as integer cents (e.g. 1234 = € 12,34).
 */

// Memoised at module level — `Intl.NumberFormat` construction is expensive.
const eurFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats an integer cent value as a localised Euro string.
 *
 * Examples:
 * - `formatEuroFromCents(123456)` → `"€ 1.234,56"`
 * - `formatEuroFromCents(0)`      → `"€ 0,00"`
 * - `formatEuroFromCents(-50)`    → `"-€ 0,50"` (defensive — should not occur)
 *
 * @param cents Integer cent value (number or bigint). Non-integer inputs are
 *   truncated via Math.trunc before dividing by 100.
 */
export function formatEuroFromCents(cents: number | bigint): string {
  const value =
    typeof cents === "bigint"
      ? Number(cents) / 100
      : Math.trunc(cents) / 100;
  return eurFormatter.format(value);
}

/**
 * Formats an ISO date string ("YYYY-MM-DD") as a long Italian date.
 *
 * Example: `"2026-12-31"` → `"31 dicembre 2026"`
 *
 * Returns an empty string if the input is null/undefined/empty.
 */
export function formatItalianDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // Parse as UTC noon to avoid off-by-one issues from local timezone shifts.
  const date = new Date(`${iso}T12:00:00Z`);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("it-IT", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
