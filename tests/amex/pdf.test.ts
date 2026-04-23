import { describe, expect, it, vi } from "vitest";
import { parseAmexPdf, parseAmexRows } from "../../src/lib/ingestion/amex/pdf";
import { AmexPdfParseError } from "../../src/lib/ingestion/amex/errors";

describe("parseAmexRows (unit)", () => {
  it("parses a typical Amex statement row block", () => {
    const rows = [
      { page: 1, y: 800, text: "American Express Personal — Estratto conto 2026" },
      { page: 1, y: 700, text: "Data Descrizione Importo" },
      { page: 1, y: 680, text: "03/03 ESSELUNGA MILANO 45,20" },
      { page: 1, y: 664, text: "05/03 TRENITALIA ROMA 12,50" },
      { page: 1, y: 648, text: "10/03 PAGAMENTO RICEVUTO 500,00 CR" },
    ];

    const txns = parseAmexRows(rows);
    expect(txns).toHaveLength(3);

    expect(txns[0]).toMatchObject({
      date: "2026-03-03",
      amount: 45.2,
      merchant_raw: "ESSELUNGA MILANO",
      merchant_normalized: "ESSELUNGA",
      currency: "EUR",
      source: "amex_pdf",
    });
    expect(txns[0].external_id).toMatch(/^[a-f0-9]{32}$/);

    expect(txns[2]).toMatchObject({
      date: "2026-03-10",
      amount: -500,
      merchant_normalized: "PAGAMENTO RICEVUTO",
    });
  });

  it("is deterministic: same input → same external_id", () => {
    const rows = [
      { page: 1, y: 800, text: "Estratto conto 2026" },
      { page: 1, y: 680, text: "03/03 ESSELUNGA MILANO 45,20" },
    ];
    const a = parseAmexRows(rows);
    const b = parseAmexRows(rows);
    expect(a[0].external_id).toBe(b[0].external_id);
  });

  it("respects statementYear option over inferred year", () => {
    const rows = [
      { page: 1, y: 800, text: "Extra 2099 Header" },
      { page: 1, y: 680, text: "03/03 ESSELUNGA 45,20" },
    ];
    const txns = parseAmexRows(rows, { statementYear: 2025 });
    expect(txns[0].date).toBe("2025-03-03");
  });

  it("emits onDiagnostic for rows with date but no amount", () => {
    const rows = [
      { page: 1, y: 800, text: "Estratto 2026" },
      { page: 1, y: 680, text: "03/03 Riga narrativa senza importo" },
      { page: 1, y: 664, text: "04/03 ESSELUNGA 10,00" },
    ];
    const diagnostics: unknown[] = [];
    const txns = parseAmexRows(rows, {
      onDiagnostic: (d) => diagnostics.push(d),
    });
    expect(txns).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0] as { kind: string }).kind).toBe("unrecognized_amount");
  });

  it("throws no_transactions_found when no row parses", () => {
    const rows = [
      { page: 1, y: 800, text: "Header only" },
      { page: 1, y: 700, text: "Another header line" },
    ];
    expect(() => parseAmexRows(rows)).toThrow(AmexPdfParseError);
  });
});

describe("parseAmexPdf (buffer-level)", () => {
  it("rejects empty buffer", async () => {
    await expect(parseAmexPdf(Buffer.alloc(0))).rejects.toMatchObject({
      code: "empty_pdf",
    });
  });

  it("rejects non-PDF buffer", async () => {
    await expect(parseAmexPdf(Buffer.from("not a pdf"))).rejects.toMatchObject({
      code: "corrupted_pdf",
    });
  });

  it("does not emit structured log when parseAmexRows is used directly", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const rows = [
        { page: 1, y: 800, text: "2026" },
        { page: 1, y: 680, text: "03/03 ESSELUNGA 45,20" },
      ];
      parseAmexRows(rows);
      const emitted = writeSpy.mock.calls
        .map((c) => String(c[0]))
        .some((line) => line.includes("amex.pdf.parsed"));
      expect(emitted).toBe(false);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
