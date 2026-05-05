/**
 * Unit tests for src/lib/domain/transactions.ts
 * Vitest — no I/O, pure functions only.
 *
 * Coverage:
 *   - aggregateByMonth: empty input, single outflow, mixed signs same month,
 *     multiple months sort order, malformed booked_at skipped without throw.
 *   - parseEuroToCents: all accepted formats, all rejection cases.
 *
 * NOTE: Uses RFC 4122-compliant UUID v4s (Zod v4 applies strict regex on
 * the version nibble [1-8]).
 *
 * NOTE(rls-isolation-test): Cross-household RLS isolation requires a real
 * DB and is covered by security-reviewer (AGENTS.md §Coverage strategy).
 */

import { describe, it, expect } from "vitest";
import { aggregateByMonth, parseEuroToCents } from "./transactions";
import type { TransactionRow } from "./transactions";

// ---------------------------------------------------------------------------
// UUID fixtures
// ---------------------------------------------------------------------------

const UUID_HH      = "74dd2f8e-ba26-49b2-a986-dbabd93d39ca";
const UUID_ACCOUNT = "0efb96b3-ce86-432b-b0d9-fbe68dea7a46";
const UUID_CLASS   = "467a8ed1-af08-4668-8e20-0940400b5712";
const UUID_TX_1    = "a7142d9c-7441-4558-b523-280957ef575b";
const UUID_TX_2    = "538fc4df-85df-423e-88fc-fc1ead3bb61a";
const UUID_TX_3    = "fde3d018-7a67-4ed7-957b-b4d058b5fcda";
const UUID_TX_4    = "97f8bfe1-96f5-4a74-b7cc-0b53f7af065e";
const UUID_TX_5    = "16f084b9-213b-4105-bfba-329b2547955b";

const NOW = "2026-05-05T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeTx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: UUID_TX_1,
    household_id: UUID_HH,
    account_id: UUID_ACCOUNT,
    class_id: null,
    booked_at: "2026-05-01",
    amount_cents: -1000,
    currency: "EUR",
    description: null,
    source: "manual",
    needs_review: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// aggregateByMonth
// ---------------------------------------------------------------------------

describe("aggregateByMonth", () => {
  describe("empty input", () => {
    it("should return [] for empty array", () => {
      expect(aggregateByMonth([])).toEqual([]);
    });
  });

  describe("single outflow row", () => {
    it("should produce 1 month bucket with correct outflow, inflow=0, count=1", () => {
      const rows = [makeTx({ id: UUID_TX_1, booked_at: "2026-05-10", amount_cents: -2500 })];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-05");
      expect(result[0].outflow_cents).toBe(-2500);
      expect(result[0].inflow_cents).toBe(0);
      expect(result[0].net_cents).toBe(-2500);
      expect(result[0].count).toBe(1);
    });
  });

  describe("single inflow row", () => {
    it("should produce 1 month bucket with correct inflow, outflow=0, count=1", () => {
      const rows = [makeTx({ id: UUID_TX_1, booked_at: "2026-03-15", amount_cents: 150000 })];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-03");
      expect(result[0].inflow_cents).toBe(150000);
      expect(result[0].outflow_cents).toBe(0);
      expect(result[0].net_cents).toBe(150000);
      expect(result[0].count).toBe(1);
    });
  });

  describe("mixed inflow + outflow in same month", () => {
    it("should sum correctly: inflow, outflow, net, count=2", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-04-05", amount_cents: 50000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-04-20", amount_cents: -30000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-04");
      expect(result[0].inflow_cents).toBe(50000);
      expect(result[0].outflow_cents).toBe(-30000);
      expect(result[0].net_cents).toBe(20000);
      expect(result[0].count).toBe(2);
    });

    it("should handle net negative when outflow > inflow", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-04-01", amount_cents: 10000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-04-28", amount_cents: -40000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result[0].net_cents).toBe(-30000);
    });
  });

  describe("multiple months — sorted DESC", () => {
    it("should return months in descending order regardless of input order", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-03-10", amount_cents: -1000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-05-10", amount_cents: -2000 }),
        makeTx({ id: UUID_TX_3, booked_at: "2026-01-15", amount_cents: -500 }),
        makeTx({ id: UUID_TX_4, booked_at: "2026-04-01", amount_cents: -3000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(4);
      expect(result.map((r) => r.month)).toEqual([
        "2026-05",
        "2026-04",
        "2026-03",
        "2026-01",
      ]);
    });

    it("should accumulate multiple rows within each month correctly", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-05-01", amount_cents: -1000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-05-15", amount_cents: -2000 }),
        makeTx({ id: UUID_TX_3, booked_at: "2026-04-10", amount_cents: 5000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(2);

      const may = result.find((r) => r.month === "2026-05");
      expect(may).toBeDefined();
      expect(may!.outflow_cents).toBe(-3000);
      expect(may!.inflow_cents).toBe(0);
      expect(may!.count).toBe(2);

      const apr = result.find((r) => r.month === "2026-04");
      expect(apr).toBeDefined();
      expect(apr!.inflow_cents).toBe(5000);
      expect(apr!.count).toBe(1);
    });
  });

  describe("rows with amount_cents = 0", () => {
    it("should count the row but not add to inflow or outflow", () => {
      // Zero-amount rows can theoretically exist in the DB (no DB constraint
      // prevents it), even if the API layer rejects them at insertion.
      const rows = [makeTx({ id: UUID_TX_1, booked_at: "2026-05-01", amount_cents: 0 })];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].inflow_cents).toBe(0);
      expect(result[0].outflow_cents).toBe(0);
      expect(result[0].net_cents).toBe(0);
      expect(result[0].count).toBe(1);
    });
  });

  describe("malformed booked_at — skipped without throwing", () => {
    it("should skip rows with empty booked_at string", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "", amount_cents: -9999 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-05-01", amount_cents: -1000 }),
      ];
      // Must not throw
      const result = aggregateByMonth(rows);

      // Only the valid row is counted
      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-05");
      expect(result[0].count).toBe(1);
    });

    it("should skip rows with non-date booked_at strings", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "invalid-date", amount_cents: -500 }),
        makeTx({ id: UUID_TX_2, booked_at: "not-a-date-at-all", amount_cents: -200 }),
        makeTx({ id: UUID_TX_3, booked_at: "2026-06-15", amount_cents: -100 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-06");
      expect(result[0].count).toBe(1);
    });

    it("should skip rows with too-short booked_at (fewer than 7 chars)", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-0", amount_cents: -300 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-07-20", amount_cents: -400 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].month).toBe("2026-07");
    });

    it("should not throw when all rows are malformed", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "", amount_cents: -100 }),
        makeTx({ id: UUID_TX_2, booked_at: "bad", amount_cents: -200 }),
      ];
      expect(() => aggregateByMonth(rows)).not.toThrow();
      expect(aggregateByMonth(rows)).toEqual([]);
    });
  });

  describe("cross-month boundary: last day vs first day", () => {
    it("should separate Jan 31 and Feb 1 into distinct month buckets", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-01-31", amount_cents: -1000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-02-01", amount_cents: -2000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(2);
      expect(result[0].month).toBe("2026-02"); // DESC
      expect(result[1].month).toBe("2026-01");
    });
  });

  describe("class_id nullable: row without class is aggregated normally", () => {
    it("should aggregate rows with class_id=null the same as assigned rows", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-05-10", class_id: null, amount_cents: -500 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-05-20", class_id: UUID_CLASS, amount_cents: -300 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(2);
      expect(result[0].outflow_cents).toBe(-800);
    });
  });

  describe("many rows same month", () => {
    it("should correctly sum 5 rows of varying sign in the same month", () => {
      const rows = [
        makeTx({ id: UUID_TX_1, booked_at: "2026-05-01", amount_cents: 100000 }),
        makeTx({ id: UUID_TX_2, booked_at: "2026-05-02", amount_cents: -20000 }),
        makeTx({ id: UUID_TX_3, booked_at: "2026-05-03", amount_cents: -5000 }),
        makeTx({ id: UUID_TX_4, booked_at: "2026-05-04", amount_cents: 15000 }),
        makeTx({ id: UUID_TX_5, booked_at: "2026-05-05", amount_cents: -8000 }),
      ];
      const result = aggregateByMonth(rows);

      expect(result).toHaveLength(1);
      expect(result[0].inflow_cents).toBe(115000);   // 100000+15000
      expect(result[0].outflow_cents).toBe(-33000);  // -20000-5000-8000
      expect(result[0].net_cents).toBe(82000);
      expect(result[0].count).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// parseEuroToCents
// ---------------------------------------------------------------------------

describe("parseEuroToCents", () => {
  describe("accepted formats — decimal comma", () => {
    it('"12,50" → 1250', () => {
      expect(parseEuroToCents("12,50")).toBe(1250);
    });

    it('"100,00" → 10000', () => {
      expect(parseEuroToCents("100,00")).toBe(10000);
    });

    it('"12,5" → 1250 (single decimal digit padded)', () => {
      expect(parseEuroToCents("12,5")).toBe(1250);
    });

    it('"0,50" → 50 (50 cents)', () => {
      expect(parseEuroToCents("0,50")).toBe(50);
    });
  });

  describe("accepted formats — decimal dot", () => {
    it('"12.50" → 1250', () => {
      expect(parseEuroToCents("12.50")).toBe(1250);
    });

    it('"12.5" → 1250 (single decimal digit padded)', () => {
      expect(parseEuroToCents("12.5")).toBe(1250);
    });
  });

  describe("accepted formats — no decimal", () => {
    it('"100" → 10000', () => {
      expect(parseEuroToCents("100")).toBe(10000);
    });

    it('"1" → 100', () => {
      expect(parseEuroToCents("1")).toBe(100);
    });

    it('"9999" → 999900', () => {
      expect(parseEuroToCents("9999")).toBe(999900);
    });
  });

  describe("accepted formats — Italian thousands (dot thousands, comma decimal)", () => {
    it('"1.234,56" → 123456', () => {
      expect(parseEuroToCents("1.234,56")).toBe(123456);
    });

    it('"10.000,00" → 1000000', () => {
      expect(parseEuroToCents("10.000,00")).toBe(1000000);
    });

    it('"1.000" → 100000 (thousands, no decimal)', () => {
      expect(parseEuroToCents("1.000")).toBe(100000);
    });

    it('"1.234,5" → 123450 (1 decimal in thousands format)', () => {
      expect(parseEuroToCents("1.234,5")).toBe(123450);
    });
  });

  describe("accepted formats — optional leading € with whitespace", () => {
    it('"€ 12,50" → 1250', () => {
      expect(parseEuroToCents("€ 12,50")).toBe(1250);
    });

    it('"€12,50" → 1250 (no space after €)', () => {
      expect(parseEuroToCents("€12,50")).toBe(1250);
    });

    it('"  €  12.50  " → 1250 (surrounding whitespace)', () => {
      expect(parseEuroToCents("  €  12.50  ")).toBe(1250);
    });

    it('"€ 1.234,56" → 123456', () => {
      expect(parseEuroToCents("€ 1.234,56")).toBe(123456);
    });
  });

  describe("rejection — zero result", () => {
    it('"0" → null', () => {
      expect(parseEuroToCents("0")).toBeNull();
    });

    it('"0,00" → null', () => {
      expect(parseEuroToCents("0,00")).toBeNull();
    });

    it('"0.00" → null', () => {
      expect(parseEuroToCents("0.00")).toBeNull();
    });
  });

  describe("rejection — too many decimals", () => {
    it('"12,555" → null (3 decimals)', () => {
      expect(parseEuroToCents("12,555")).toBeNull();
    });

    it('"12.555" → 1255500 (parsed as Italian thousands: 12.555 = 12,555)', () => {
      // "12.555" matches Italian thousands regex (\d{1,3})(\.\d{3})+ with
      // 1-3 leading digits followed by one .ddd group → treated as 12,555
      // (twelve thousand five hundred fifty-five), no decimal part → 1255500 cents.
      // The caller is expected to reject implausibly large amounts at the UI layer.
      expect(parseEuroToCents("12.555")).toBe(1255500);
    });

    it('"1,1234" → null (4 decimals)', () => {
      expect(parseEuroToCents("1,1234")).toBeNull();
    });
  });

  describe("rejection — non-numeric", () => {
    it('"abc" → null', () => {
      expect(parseEuroToCents("abc")).toBeNull();
    });

    it('"12abc" → null', () => {
      expect(parseEuroToCents("12abc")).toBeNull();
    });

    it('"12,ab" → null', () => {
      expect(parseEuroToCents("12,ab")).toBeNull();
    });

    it('"€" → null (symbol with no number)', () => {
      expect(parseEuroToCents("€")).toBeNull();
    });
  });

  describe("rejection — empty / whitespace", () => {
    it('"" → null', () => {
      expect(parseEuroToCents("")).toBeNull();
    });

    it('"   " → null (whitespace only)', () => {
      expect(parseEuroToCents("   ")).toBeNull();
    });
  });

  describe("rejection — negative inputs (sign applied by caller)", () => {
    it('"-12" → null', () => {
      expect(parseEuroToCents("-12")).toBeNull();
    });

    it('"-12,50" → null', () => {
      expect(parseEuroToCents("-12,50")).toBeNull();
    });

    it('"€ -12,50" → null (negative after €)', () => {
      // After stripping €, the remainder is "-12,50" which starts with "-"
      expect(parseEuroToCents("€ -12,50")).toBeNull();
    });
  });

  describe("edge cases — large amounts", () => {
    it('"1.000.000,00" → 100000000', () => {
      expect(parseEuroToCents("1.000.000,00")).toBe(100000000);
    });

    it('"999999" → 99999900', () => {
      expect(parseEuroToCents("999999")).toBe(99999900);
    });
  });

  describe("edge cases — rounding fidelity", () => {
    it('"99,99" → 9999', () => {
      expect(parseEuroToCents("99,99")).toBe(9999);
    });

    it('"0,01" → 1 (minimum expressible unit)', () => {
      expect(parseEuroToCents("0,01")).toBe(1);
    });
  });
});
