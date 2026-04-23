import { describe, expect, it } from "vitest";
import {
  detectFormat,
  detectSeparator,
  listFormats,
  parseCsv,
  stripBom,
} from "../../src/lib/ingestion/generic-csv";

describe("generic-csv utilities", () => {
  it("strips UTF-8 BOM", () => {
    const withBom = "﻿a,b\n1,2";
    expect(stripBom(withBom).startsWith("a,b")).toBe(true);
  });

  it("detects separator by frequency", () => {
    expect(detectSeparator("a,b,c")).toBe(",");
    expect(detectSeparator("a;b;c")).toBe(";");
    expect(detectSeparator("a\tb\tc")).toBe("\t");
  });

  it("does not count separator chars inside quotes", () => {
    expect(detectSeparator('"a,b,c";d;e')).toBe(";");
  });

  it("parses CSV rows honoring quotes and escaped quotes", () => {
    const text = 'col1,col2\n"hello, world","quote ""test"""';
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(["col1", "col2"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].col1).toBe("hello, world");
    expect(parsed.rows[0].col2).toBe('quote "test"');
  });

  it("auto-detects `;` separator when `,` is embedded in amount", () => {
    const text = "Data;Importo\n03/03/2026;\"45,20\"";
    const parsed = parseCsv(text);
    expect(parsed.separator).toBe(";");
    expect(parsed.rows[0].Importo).toBe("45,20");
  });

  it("skips fully empty lines", () => {
    const text = "a,b\n1,2\n\n3,4\n";
    const parsed = parseCsv(text);
    expect(parsed.rows).toHaveLength(2);
  });
});

describe("detectFormat", () => {
  it("matches Amex IT portal headers", () => {
    const format = detectFormat([
      "Data",
      "Data di registrazione",
      "Descrizione",
      "Importo",
      "Categoria Amex",
    ]);
    expect(format?.id).toBe("amex_it");
  });

  it("matches case-insensitive", () => {
    const format = detectFormat(["data", "descrizione", "importo"]);
    expect(format?.id).toBe("amex_it");
  });

  it("returns null for non-Amex headers", () => {
    const format = detectFormat(["Date", "Description", "Amount"]);
    expect(format).toBeNull();
  });

  it("returns null when required columns are missing", () => {
    const format = detectFormat(["Data", "Descrizione"]);
    expect(format).toBeNull();
  });
});

describe("listFormats", () => {
  it("exposes at least amex_it format", () => {
    const ids = listFormats().map((f) => f.id);
    expect(ids).toContain("amex_it");
  });
});
