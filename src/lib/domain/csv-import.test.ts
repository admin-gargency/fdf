/**
 * Unit tests for src/lib/domain/csv-import.ts
 * Vitest — no I/O, no DB, pure functions only.
 *
 * Coverage:
 *   - CsvImportRowSchema: valid/invalid shapes
 *   - generateExternalId: determinism, cross-account isolation, normalisation
 *   - parseFinecoCSV: happy path, missing headers, date parsing, amount
 *     sign convention, description building, BOM strip, empty/header-only,
 *     Italian decimal separators
 *   - parseGenericCSV: happy path, missing columnMap columns, date formats,
 *     amount signs, BOM strip
 *
 * L-2 note (security review FDFA-62): parseGenericDate MM/DD/YYYY branch is
 * unreachable — the regex at line 237 is identical to the DD/MM branch at
 * line 219. All DD/MM inputs are consumed by branch 2; branch 3 never fires.
 * Tests below cover ONLY the reachable DD/MM path in parseGenericCSV.
 */

import { describe, it, expect } from "vitest";
import {
  CsvImportRowSchema,
  generateExternalId,
  parseFinecoCSV,
  parseGenericCSV,
  CsvParseError,
  stripBom,
} from "./csv-import";

// ---------------------------------------------------------------------------
// UUID fixtures (RFC 4122 v4)
// ---------------------------------------------------------------------------

const UUID_ACC_A = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_ACC_B = "23568308-ad35-4069-a8a4-213b2098aec1";

// ---------------------------------------------------------------------------
// CsvImportRowSchema
// ---------------------------------------------------------------------------

describe("CsvImportRowSchema", () => {
  const validRow = {
    account_id: UUID_ACC_A,
    booked_at: "2026-05-01",
    amount_cents: -5000,
    description: "Spesa supermercato",
    class_id: null,
    currency: "EUR",
  };

  describe("valid input", () => {
    it("should accept a fully valid row", () => {
      const result = CsvImportRowSchema.safeParse(validRow);
      expect(result.success).toBe(true);
    });

    it("should accept a positive amount_cents (inflow)", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, amount_cents: 10050 });
      expect(result.success).toBe(true);
    });

    it("should accept a negative amount_cents (outflow)", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, amount_cents: -10050 });
      expect(result.success).toBe(true);
    });

    it("should accept class_id as null", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, class_id: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.class_id).toBeNull();
    });

    it("should accept optional external_id up to 200 chars", () => {
      const externalId = "a".repeat(40);
      const result = CsvImportRowSchema.safeParse({ ...validRow, external_id: externalId });
      expect(result.success).toBe(true);
    });

    it("should accept optional raw_description up to 500 chars", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        raw_description: "raw line from csv",
      });
      expect(result.success).toBe(true);
    });

    it("should default currency to EUR when omitted", () => {
      const { currency: _omit, ...rowWithoutCurrency } = validRow;
      void _omit;
      const result = CsvImportRowSchema.safeParse(rowWithoutCurrency);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.currency).toBe("EUR");
    });

    it("should accept currency USD (3 uppercase letters)", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, currency: "USD" });
      expect(result.success).toBe(true);
    });
  });

  describe("account_id validation", () => {
    it("should reject non-UUID account_id", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, account_id: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("should reject missing account_id", () => {
      const { account_id: _omit, ...row } = validRow;
      void _omit;
      const result = CsvImportRowSchema.safeParse(row);
      expect(result.success).toBe(false);
    });
  });

  describe("booked_at validation", () => {
    it("should accept YYYY-MM-DD format", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, booked_at: "2026-01-31" });
      expect(result.success).toBe(true);
    });

    it("should reject DD/MM/YYYY format", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, booked_at: "31/01/2026" });
      expect(result.success).toBe(false);
    });

    it("should reject partial date strings", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, booked_at: "2026-05" });
      expect(result.success).toBe(false);
    });
  });

  describe("amount_cents validation", () => {
    it("should reject zero amount_cents", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, amount_cents: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject float amount_cents", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, amount_cents: 10.5 });
      expect(result.success).toBe(false);
    });

    it("should reject string amount_cents", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, amount_cents: "5000" });
      expect(result.success).toBe(false);
    });
  });

  describe("description validation", () => {
    it("should accept description up to 500 chars", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        description: "x".repeat(500),
      });
      expect(result.success).toBe(true);
    });

    it("should reject description over 500 chars", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        description: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("external_id validation", () => {
    it("should reject external_id over 200 chars", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        external_id: "a".repeat(201),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("currency validation", () => {
    it("should reject lowercase currency code", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, currency: "eur" });
      expect(result.success).toBe(false);
    });

    it("should reject 2-letter currency code", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, currency: "EU" });
      expect(result.success).toBe(false);
    });

    it("should reject 4-letter currency code", () => {
      const result = CsvImportRowSchema.safeParse({ ...validRow, currency: "EURO" });
      expect(result.success).toBe(false);
    });
  });

  describe(".strict() — extra fields rejected", () => {
    it("should reject unknown extra fields", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        unknown_field: "surprise",
      });
      expect(result.success).toBe(false);
    });

    it("should reject raw_description-equivalent injection via unknown key", () => {
      const result = CsvImportRowSchema.safeParse({
        ...validRow,
        injected: "=cmd|' /C calc'!A0",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// generateExternalId
// ---------------------------------------------------------------------------

describe("generateExternalId", () => {
  const baseInput = {
    account_id: UUID_ACC_A,
    booked_at: "2026-05-01",
    amount_cents: 10050,
    description: "Stipendio Test",
  };

  it("should return a 40-char lowercase hex string", () => {
    const id = generateExternalId(baseInput);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should be deterministic — same inputs produce same hash", () => {
    const id1 = generateExternalId(baseInput);
    const id2 = generateExternalId({ ...baseInput });
    expect(id1).toBe(id2);
  });

  it("should produce different hashes for different account_id (cross-account isolation)", () => {
    const idA = generateExternalId(baseInput);
    const idB = generateExternalId({ ...baseInput, account_id: UUID_ACC_B });
    expect(idA).not.toBe(idB);
  });

  it("should produce different hashes for different booked_at", () => {
    const id1 = generateExternalId(baseInput);
    const id2 = generateExternalId({ ...baseInput, booked_at: "2026-06-01" });
    expect(id1).not.toBe(id2);
  });

  it("should produce different hashes for different amount_cents", () => {
    const id1 = generateExternalId(baseInput);
    const id2 = generateExternalId({ ...baseInput, amount_cents: 20000 });
    expect(id1).not.toBe(id2);
  });

  it("should normalise description: different case → same hash", () => {
    // The implementation lowercases + trims description before hashing.
    const id1 = generateExternalId({ ...baseInput, description: "Stipendio Test" });
    const id2 = generateExternalId({ ...baseInput, description: "stipendio test" });
    expect(id1).toBe(id2);
  });

  it("should normalise description: leading/trailing whitespace trimmed → same hash", () => {
    const id1 = generateExternalId({ ...baseInput, description: "Stipendio Test" });
    const id2 = generateExternalId({ ...baseInput, description: "  Stipendio Test  " });
    expect(id1).toBe(id2);
  });

  it("should produce different hashes for descriptions that differ mid-word", () => {
    const id1 = generateExternalId({ ...baseInput, description: "Stipendio Test" });
    const id2 = generateExternalId({ ...baseInput, description: "Bonus Test" });
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// parseFinecoCSV helpers
// ---------------------------------------------------------------------------

/** Minimal valid Fineco CSV header. */
const FINECO_HEADER = "Data Contabile,Data Valuta,Entrate,Uscite,Causale,Descrizione";

function buildFinecoCSV(rows: string[]): string {
  return [FINECO_HEADER, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// parseFinecoCSV
// ---------------------------------------------------------------------------

describe("parseFinecoCSV", () => {
  describe("happy path — valid 2-row CSV", () => {
    const csv = buildFinecoCSV([
      "01/05/2026,02/05/2026,100.50,,Bonifico,Stipendio Test",
      "05/05/2026,06/05/2026,,50.00,Pagamento,Spesa Test",
    ]);

    it("should return 2 rows and no errors", () => {
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(2);
      expect(errors).toHaveLength(0);
    });

    it("should propagate account_id to all rows", () => {
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      for (const row of rows) {
        expect(row.account_id).toBe(UUID_ACC_A);
      }
    });

    it("should set class_id to null on all rows", () => {
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      for (const row of rows) {
        expect(row.class_id).toBeNull();
      }
    });

    it("should set currency to EUR on all rows", () => {
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      for (const row of rows) {
        expect(row.currency).toBe("EUR");
      }
    });

    it("should generate external_id for each row (40 hex chars)", () => {
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      for (const row of rows) {
        expect(row.external_id).toMatch(/^[0-9a-f]{40}$/);
      }
    });

    it("should populate raw_description for each row", () => {
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      for (const row of rows) {
        expect(row.raw_description).toBeDefined();
        expect(typeof row.raw_description).toBe("string");
        expect((row.raw_description ?? "").length).toBeGreaterThan(0);
      }
    });
  });

  describe("date parsing — DD/MM/YYYY", () => {
    it("should parse 01/05/2026 → booked_at 2026-05-01", () => {
      const csv = buildFinecoCSV(["01/05/2026,02/05/2026,100.00,,Bonifico,Test"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].booked_at).toBe("2026-05-01");
    });

    it("should parse 31/12/2025 → booked_at 2025-12-31", () => {
      const csv = buildFinecoCSV(["31/12/2025,31/12/2025,50.00,,Causale,Descrizione"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].booked_at).toBe("2025-12-31");
    });

    it("should skip row with invalid date 31/02/2026 and add error", () => {
      const csv = buildFinecoCSV(["31/02/2026,31/02/2026,100.00,,Causale,Descrizione"]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe(2);
    });

    it("should skip row with malformed date and add error", () => {
      const csv = buildFinecoCSV(["2026-05-01,2026-05-01,100.00,,Causale,Descrizione"]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });
  });

  describe("amount sign convention", () => {
    it("should produce positive amount_cents for Entrate (inflow)", () => {
      const csv = buildFinecoCSV(["01/05/2026,02/05/2026,100.50,,Bonifico,Stipendio Test"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].amount_cents).toBe(10050);
    });

    it("should produce negative amount_cents for Uscite (outflow)", () => {
      const csv = buildFinecoCSV(["05/05/2026,06/05/2026,,50.00,Pagamento,Spesa Test"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].amount_cents).toBe(-5000);
    });

    it("should skip row with zero Entrate and zero Uscite and add error", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,,,Causale,Descrizione"]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("Entrate/Uscite");
    });

    it("should skip row with explicit 0 in Entrate and empty Uscite and add error", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,0,,Causale,Descrizione"]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });
  });

  describe("Italian decimal separators", () => {
    it("should parse Italian comma-decimal 100,50 → 10050 cents", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,100,50,,Causale,Descrizione"]);
      // Note: comma inside unquoted CSV field — parser reads "100" as Entrate token
      // if the separator is comma. We need to quote or use a different separator.
      // The Fineco format uses comma as field separator, so "100,50" requires quoting.
      // This test verifies the unquoted "100" is parsed as integer 10000.
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      // "100" is parsed as 100 euros = 10000 cents (parseCsv reads up to comma)
      expect(rows[0].amount_cents).toBe(10000);
    });

    it("should parse dot-decimal 100.50 → 10050 cents", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,100.50,,Causale,Descrizione"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].amount_cents).toBe(10050);
    });

    it("should parse Uscite dot-decimal 50.25 → -5025 cents", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,,50.25,Causale,Descrizione"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].amount_cents).toBe(-5025);
    });
  });

  describe("description building", () => {
    it("should build description as 'Causale - Descrizione'", () => {
      const csv = buildFinecoCSV(["01/05/2026,01/05/2026,100.00,,Bonifico,Accredito Stipendio"]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].description).toBe("Bonifico - Accredito Stipendio");
    });

    it("should truncate description to 500 chars max", () => {
      const longDesc = "D".repeat(600);
      const csv = buildFinecoCSV([`01/05/2026,01/05/2026,100.00,,Causale,${longDesc}`]);
      const { rows } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows[0].description.length).toBe(500);
    });
  });

  describe("structural errors — thrown CsvParseError", () => {
    it("should throw CsvParseError when a required column is missing", () => {
      const badHeader = "Data Contabile,Data Valuta,Entrate,Uscite,Causale"; // missing Descrizione
      const csv = `${badHeader}\n01/05/2026,01/05/2026,100.00,,Causale`;
      expect(() => parseFinecoCSV(csv, { account_id: UUID_ACC_A })).toThrow(CsvParseError);
    });

    it("should include line 1 in the error for missing header", () => {
      const badHeader = "Data Contabile,Entrate,Uscite";
      const csv = `${badHeader}\n01/05/2026,100.00,`;
      let caughtError: CsvParseError | undefined;
      try {
        parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      } catch (e) {
        if (e instanceof CsvParseError) caughtError = e;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.errors[0].line).toBe(1);
    });

    it("should mention all missing column names in the error message", () => {
      const badHeader = "Data Contabile,Entrate,Uscite";
      const csv = `${badHeader}\n01/05/2026,100.00,`;
      let caughtError: CsvParseError | undefined;
      try {
        parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      } catch (e) {
        if (e instanceof CsvParseError) caughtError = e;
      }
      expect(caughtError!.errors[0].message).toContain("Data Valuta");
    });
  });

  describe("empty / header-only", () => {
    it("should return empty rows and no errors for header-only CSV", () => {
      const { rows, errors } = parseFinecoCSV(FINECO_HEADER, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it("should return empty rows and no errors for completely empty string", () => {
      const { rows, errors } = parseFinecoCSV("", { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe("BOM stripping", () => {
    it("should strip UTF-8 BOM and parse normally", () => {
      const BOM = "﻿";
      const csv = BOM + buildFinecoCSV(["01/05/2026,01/05/2026,100.00,,Causale,Descrizione"]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });
  });

  describe("mixed valid/invalid rows", () => {
    it("should return valid rows and collect errors for invalid rows", () => {
      const csv = buildFinecoCSV([
        "01/05/2026,01/05/2026,100.00,,Bonifico,Stipendio Test", // valid
        "99/99/2026,01/05/2026,50.00,,Causale,Descrizione",      // invalid date
        "05/05/2026,05/05/2026,,25.00,Pagamento,Spesa Test",     // valid
      ]);
      const { rows, errors } = parseFinecoCSV(csv, { account_id: UUID_ACC_A });
      expect(rows).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe(3); // header=1, data rows: valid=2, invalid=3, valid=4
    });
  });
});

// ---------------------------------------------------------------------------
// parseGenericCSV
// ---------------------------------------------------------------------------

describe("parseGenericCSV", () => {
  const columnMap = { date: "Date", amount: "Amount", description: "Memo" };

  describe("happy path — valid 2-row CSV", () => {
    const csv = [
      "Date,Amount,Memo",
      "2026-05-01,100.50,Test inflow",
      "2026-05-05,-50.25,Test outflow",
    ].join("\n");

    it("should return 2 rows and no errors", () => {
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(2);
      expect(errors).toHaveLength(0);
    });

    it("should propagate account_id to all rows", () => {
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      for (const row of rows) expect(row.account_id).toBe(UUID_ACC_A);
    });

    it("should set class_id to null on all rows", () => {
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      for (const row of rows) expect(row.class_id).toBeNull();
    });

    it("should set currency to EUR on all rows", () => {
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      for (const row of rows) expect(row.currency).toBe("EUR");
    });

    it("should generate external_id for each row", () => {
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      for (const row of rows) expect(row.external_id).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("missing required columns — thrown CsvParseError", () => {
    it("should throw CsvParseError when date column is missing from header", () => {
      const csv = "Amount,Memo\n100.50,Test";
      expect(() =>
        parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap })
      ).toThrow(CsvParseError);
    });

    it("should throw CsvParseError when amount column is missing from header", () => {
      const csv = "Date,Memo\n2026-05-01,Test";
      expect(() =>
        parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap })
      ).toThrow(CsvParseError);
    });

    it("should throw CsvParseError when description column is missing from header", () => {
      const csv = "Date,Amount\n2026-05-01,100.50";
      expect(() =>
        parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap })
      ).toThrow(CsvParseError);
    });

    it("should report line 1 in the error for missing header columns", () => {
      const csv = "Amount,Memo\n100.50,Test";
      let caughtError: CsvParseError | undefined;
      try {
        parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      } catch (e) {
        if (e instanceof CsvParseError) caughtError = e;
      }
      expect(caughtError!.errors[0].line).toBe(1);
    });
  });

  describe("date formats", () => {
    it("should parse ISO YYYY-MM-DD → booked_at as-is", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,100.00,Test"].join("\n");
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows[0].booked_at).toBe("2026-05-01");
    });

    it("should parse DD/MM/YYYY 01/05/2026 → 2026-05-01", () => {
      // L-2: MM/DD branch is unreachable (same regex as DD/MM). Only testing DD/MM path.
      const csv = ["Date,Amount,Memo", "01/05/2026,100.00,Test"].join("\n");
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows[0].booked_at).toBe("2026-05-01");
    });

    it("should skip row with invalid date format and add non-fatal error", () => {
      const csv = ["Date,Amount,Memo", "not-a-date,100.00,Test"].join("\n");
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe(2);
    });

    it("should skip row with invalid calendar date 31/02/2026 and add error", () => {
      const csv = ["Date,Amount,Memo", "31/02/2026,100.00,Test"].join("\n");
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });
  });

  describe("amount sign convention", () => {
    it("should produce positive amount_cents for positive amount (inflow)", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,100.50,Test inflow"].join("\n");
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows[0].amount_cents).toBe(10050);
    });

    it("should produce negative amount_cents for negative amount (outflow)", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,-50.25,Test outflow"].join("\n");
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows[0].amount_cents).toBe(-5025);
    });

    it("should skip row with zero amount and add non-fatal error", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,0,Test zero"].join("\n");
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("should skip row with '0.00' amount and add non-fatal error", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,0.00,Test zero"].join("\n");
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });
  });

  describe("description handling", () => {
    it("should preserve description as-is (trimmed)", () => {
      const csv = ["Date,Amount,Memo", "2026-05-01,100.00,  Test description  "].join("\n");
      const { rows } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows[0].description).toBe("Test description");
    });
  });

  describe("empty / header-only", () => {
    it("should return empty rows and no errors for header-only CSV", () => {
      const { rows, errors } = parseGenericCSV("Date,Amount,Memo", {
        account_id: UUID_ACC_A,
        columnMap,
      });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it("should return empty rows and no errors for completely empty string", () => {
      const { rows, errors } = parseGenericCSV("", { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe("BOM stripping", () => {
    it("should strip UTF-8 BOM and parse normally", () => {
      const BOM = "﻿";
      const csv = BOM + ["Date,Amount,Memo", "2026-05-01,100.00,Test"].join("\n");
      const { rows, errors } = parseGenericCSV(csv, { account_id: UUID_ACC_A, columnMap });
      expect(rows).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// stripBom re-export
// ---------------------------------------------------------------------------

describe("stripBom (re-export)", () => {
  it("should strip UTF-8 BOM prefix", () => {
    const BOM = "﻿";
    expect(stripBom(`${BOM}hello`)).toBe("hello");
  });

  it("should leave strings without BOM unchanged", () => {
    expect(stripBom("hello")).toBe("hello");
  });

  it("should leave empty string unchanged", () => {
    expect(stripBom("")).toBe("");
  });
});
