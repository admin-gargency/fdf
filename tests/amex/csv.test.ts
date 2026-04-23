import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseAmexCsv } from "../../src/lib/ingestion/amex/csv";
import { AmexCsvParseError } from "../../src/lib/ingestion/amex/errors";
import { parseAmexRows } from "../../src/lib/ingestion/amex/pdf";

const FIXTURE = join(__dirname, "fixtures/csv/statement-sample.csv");

describe("parseAmexCsv (unit)", () => {
  it("parses the synthetic Amex IT fixture", () => {
    const text = readFileSync(FIXTURE, "utf8");
    const { transactions, format, diagnostics } = parseAmexCsv(text);

    expect(format.id).toBe("amex_it");
    expect(diagnostics).toHaveLength(0);
    expect(transactions).toHaveLength(5);

    expect(transactions[0]).toMatchObject({
      date: "2026-03-03",
      amount: 45.2,
      merchant_raw: "ESSELUNGA MILANO",
      merchant_normalized: "ESSELUNGA",
      currency: "EUR",
      source: "amex_csv",
    });
    expect(transactions[0].external_id).toMatch(/^[a-f0-9]{32}$/);

    expect(transactions[2]).toMatchObject({
      date: "2026-03-10",
      amount: -500,
      merchant_normalized: "PAGAMENTO RICEVUTO",
    });
  });

  it("accepts `,` separator as well as `;`", () => {
    const csv =
      "Data,Data di registrazione,Descrizione,Importo,Categoria Amex\n" +
      '03/03/2026,04/03/2026,ESSELUNGA,"45,20",Alimentari\n';
    const { transactions } = parseAmexCsv(csv);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amount).toBe(45.2);
  });

  it("strips BOM and parses", () => {
    const csv =
      "﻿Data;Data di registrazione;Descrizione;Importo;Categoria Amex\n" +
      '03/03/2026;04/03/2026;ESSELUNGA;"45,20";Alimentari\n';
    const { transactions } = parseAmexCsv(csv);
    expect(transactions).toHaveLength(1);
  });

  it("is deterministic: same input → same external_id", () => {
    const text = readFileSync(FIXTURE, "utf8");
    const a = parseAmexCsv(text).transactions;
    const b = parseAmexCsv(text).transactions;
    for (let i = 0; i < a.length; i++) {
      expect(a[i].external_id).toBe(b[i].external_id);
    }
  });

  it("emits diagnostic for row with invalid date but keeps others", () => {
    const csv =
      "Data;Data di registrazione;Descrizione;Importo;Categoria Amex\n" +
      'garbage;04/03/2026;ESSELUNGA;"45,20";Alimentari\n' +
      '05/03/2026;06/03/2026;TRENITALIA;"12,50";Trasporti\n';
    const diagnostics: unknown[] = [];
    const { transactions } = parseAmexCsv(csv, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    expect(transactions).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0] as { kind: string }).kind).toBe(
      "unrecognized_date",
    );
  });

  it("throws unsupported_format on non-Amex headers", () => {
    const csv = "Date,Description,Amount\n2026-03-03,ESSELUNGA,45.20\n";
    expect(() => parseAmexCsv(csv)).toThrowError(AmexCsvParseError);
    try {
      parseAmexCsv(csv);
    } catch (err) {
      expect((err as AmexCsvParseError).code).toBe("unsupported_format");
    }
  });

  it("throws empty_csv on blank input", () => {
    expect(() => parseAmexCsv("")).toThrowError(AmexCsvParseError);
    expect(() => parseAmexCsv("   \n\n")).toThrowError(AmexCsvParseError);
  });

  it("throws no_transactions_found when header matches but no parseable rows", () => {
    const csv =
      "Data;Data di registrazione;Descrizione;Importo;Categoria Amex\n" +
      "garbage;garbage;garbage;garbage;garbage\n";
    try {
      parseAmexCsv(csv);
      throw new Error("expected AmexCsvParseError");
    } catch (err) {
      expect((err as AmexCsvParseError).code).toBe("no_transactions_found");
    }
  });

  it("output shape matches PDF parser transaction fields", () => {
    const pdfRows = [
      { page: 1, y: 800, text: "Estratto 2026" },
      { page: 1, y: 680, text: "03/03 ESSELUNGA MILANO 45,20" },
    ];
    const pdfTxns = parseAmexRows(pdfRows);

    const csv =
      "Data;Data di registrazione;Descrizione;Importo;Categoria Amex\n" +
      '03/03/2026;04/03/2026;ESSELUNGA MILANO;"45,20";Alimentari\n';
    const { transactions: csvTxns } = parseAmexCsv(csv);

    const pdf = pdfTxns[0];
    const csvTx = csvTxns[0];
    expect(Object.keys(csvTx).sort()).toEqual(Object.keys(pdf).sort());
    expect({
      date: csvTx.date,
      amount: csvTx.amount,
      merchant_normalized: csvTx.merchant_normalized,
      currency: csvTx.currency,
    }).toEqual({
      date: pdf.date,
      amount: pdf.amount,
      merchant_normalized: pdf.merchant_normalized,
      currency: pdf.currency,
    });
  });

  it("does not silently swallow stdout logs", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      parseAmexCsv(readFileSync(FIXTURE, "utf8"));
      const emitted = writeSpy.mock.calls
        .map((c) => String(c[0]))
        .some((line) => line.includes("amex.csv.parsed"));
      expect(emitted).toBe(true);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
