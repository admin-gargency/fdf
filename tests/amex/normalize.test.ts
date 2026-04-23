import { describe, expect, it } from "vitest";
import {
  normalizeMerchant,
  parseItalianAmount,
  parseItalianDate,
} from "../../src/lib/ingestion/amex/normalize";

describe("parseItalianDate", () => {
  it("parses DD/MM with fallback year", () => {
    expect(parseItalianDate("15/03", 2026)).toBe("2026-03-15");
  });

  it("parses DD/MM/YY full", () => {
    expect(parseItalianDate("15/03/26")).toBe("2026-03-15");
  });

  it("parses DD/MM/YYYY", () => {
    expect(parseItalianDate("03/12/2025")).toBe("2025-12-03");
  });

  it("parses Italian month names", () => {
    expect(parseItalianDate("3 marzo 2026")).toBe("2026-03-03");
    expect(parseItalianDate("15 GEN", 2026)).toBe("2026-01-15");
  });

  it("rejects obviously bad dates", () => {
    expect(parseItalianDate("32/03/2026")).toBeNull();
    expect(parseItalianDate("15/13/2026")).toBeNull();
    expect(parseItalianDate("foo")).toBeNull();
  });
});

describe("parseItalianAmount", () => {
  it("parses plain amount with comma decimals", () => {
    expect(parseItalianAmount("45,00")).toBe(45);
    expect(parseItalianAmount("1.234,56")).toBe(1234.56);
  });

  it("parses negative and CR suffix as negative", () => {
    expect(parseItalianAmount("-12,30")).toBe(-12.3);
    expect(parseItalianAmount("12,30 CR")).toBe(-12.3);
    expect(parseItalianAmount("(12,30)")).toBe(-12.3);
  });

  it("strips currency glyphs and spaces", () => {
    expect(parseItalianAmount("€ 99,99")).toBe(99.99);
    expect(parseItalianAmount("99,99 €")).toBe(99.99);
  });

  it("returns null on garbage", () => {
    expect(parseItalianAmount("foo")).toBeNull();
    expect(parseItalianAmount("")).toBeNull();
  });
});

describe("normalizeMerchant", () => {
  it("uppercases and strips Italian location suffix", () => {
    expect(normalizeMerchant("Esselunga Milano")).toBe("ESSELUNGA");
  });

  it("removes long numeric reference codes", () => {
    expect(normalizeMerchant("AMAZON MKTPL 8001234567")).toBe("AMAZON MKTPL");
  });

  it("collapses whitespace", () => {
    expect(normalizeMerchant("  TRENITALIA   ROMA  ")).toBe("TRENITALIA");
  });

  it("returns empty string when nothing remains", () => {
    expect(normalizeMerchant("    ")).toBe("");
  });
});
