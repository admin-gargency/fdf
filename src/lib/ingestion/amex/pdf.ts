import { createHash } from "node:crypto";

import { AmexPdfParseError } from "./errors";
import { logAmexPdfParsed } from "./log";
import {
  normalizeMerchant,
  parseItalianAmount,
  parseItalianDate,
} from "./normalize";
import type {
  AmexPdfDiagnostic,
  AmexPdfParseOptions,
  AmexTransaction,
} from "./types";

const DATE_HEAD_RE =
  /^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}\s+[A-Za-zìàèéò\.]+(?:\s+\d{2,4})?)\b/;

const AMOUNT_TAIL_RE = /(-?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s*CR)?)\s*$/;

const YEAR_IN_HEADER_RE = /\b(20\d{2})\b/;

export interface PdfTextRow {
  page: number;
  y: number;
  text: string;
}

export async function parseAmexPdf(
  buffer: Buffer | Uint8Array,
  options: AmexPdfParseOptions = {},
): Promise<AmexTransaction[]> {
  const start = Date.now();
  const rows = await extractRows(buffer);
  return parseRows(rows, options, {
    durationMs: Date.now() - start,
  });
}

export function parseAmexRows(
  rows: PdfTextRow[],
  options: AmexPdfParseOptions = {},
): AmexTransaction[] {
  return parseRows(rows, options, { durationMs: 0, skipLog: true });
}

async function extractRows(
  buffer: Buffer | Uint8Array,
): Promise<PdfTextRow[]> {
  if (!buffer || buffer.byteLength === 0) {
    throw new AmexPdfParseError("empty_pdf", "PDF buffer is empty");
  }

  const data =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const firstBytes = Buffer.from(data.slice(0, 4)).toString("utf8");
  if (!firstBytes.startsWith("%PDF")) {
    throw new AmexPdfParseError(
      "corrupted_pdf",
      "Buffer does not look like a PDF document",
      { firstBytesHex: Buffer.from(data.slice(0, 4)).toString("hex") },
    );
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message) || /encrypt/i.test(message)) {
      throw new AmexPdfParseError("encrypted_pdf", "PDF is encrypted", {
        pdfjsMessage: message,
      });
    }
    throw new AmexPdfParseError("corrupted_pdf", "pdfjs-dist failed to open PDF", {
      pdfjsMessage: message,
    });
  }

  const rows: PdfTextRow[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const grouped = groupItemsIntoRows(content.items);
      for (const row of grouped) {
        rows.push({ page: i, y: row.y, text: row.text });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return rows;
}

interface RawItem {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
}

function groupItemsIntoRows(
  items: unknown[],
): Array<{ y: number; text: string }> {
  const normalized = items
    .map((raw) => raw as RawItem)
    .filter((it) => typeof it.str === "string")
    .map((it) => ({
      x: Array.isArray(it.transform) ? (it.transform[4] ?? 0) : 0,
      y: Array.isArray(it.transform) ? (it.transform[5] ?? 0) : 0,
      str: it.str,
    }))
    .filter((it) => it.str.trim().length > 0);

  const buckets = new Map<number, Array<{ x: number; str: string }>>();
  for (const it of normalized) {
    const bucket = Math.round(it.y * 2) / 2;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push({ x: it.x, str: it.str });
  }

  const rows: Array<{ y: number; text: string }> = [];
  for (const [y, tokens] of buckets) {
    tokens.sort((a, b) => a.x - b.x);
    const text = tokens.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim();
    if (text) rows.push({ y, text });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows;
}

function parseRows(
  rows: PdfTextRow[],
  options: AmexPdfParseOptions,
  meta: { durationMs: number; skipLog?: boolean },
): AmexTransaction[] {
  const statementYear = options.statementYear ?? detectStatementYear(rows);
  const currency = options.currency ?? "EUR";
  const diagnostics: AmexPdfDiagnostic[] = [];
  const report = (d: AmexPdfDiagnostic) => {
    diagnostics.push(d);
    options.onDiagnostic?.(d);
  };

  const txns: AmexTransaction[] = [];
  const pages = new Set<number>();

  for (const row of rows) {
    pages.add(row.page);
    const parsed = parseTransactionRow(row, statementYear);
    if (!parsed) continue;

    if (!parsed.date) {
      report({
        kind: "unrecognized_date",
        page: row.page,
        rawRow: row.text,
        reason: "no parseable date at start of row",
      });
      continue;
    }
    if (parsed.amount === null) {
      report({
        kind: "unrecognized_amount",
        page: row.page,
        rawRow: row.text,
        reason: "trailing token is not an Italian amount",
      });
      continue;
    }

    const merchant_raw = parsed.merchantRaw.trim();
    const merchant_normalized = normalizeMerchant(merchant_raw);
    if (!merchant_normalized) {
      report({
        kind: "skipped_row",
        page: row.page,
        rawRow: row.text,
        reason: "merchant normalized to empty string",
      });
      continue;
    }

    txns.push({
      date: parsed.date,
      amount: parsed.amount,
      merchant_raw,
      merchant_normalized,
      currency,
      source: "amex_pdf",
      external_id: computeExternalId(parsed.date, parsed.amount, merchant_raw),
    });
  }

  if (txns.length === 0) {
    throw new AmexPdfParseError(
      "no_transactions_found",
      "Parser processed PDF but recognised zero transaction rows",
      { rawRowsSampled: rows.length, statementYear },
    );
  }

  if (!meta.skipLog) {
    logAmexPdfParsed({
      transactions: txns.length,
      pages: pages.size,
      durationMs: meta.durationMs,
      statementYear,
      diagnostics: diagnostics.length,
    });
  }

  return txns;
}

interface ParsedRow {
  date: string | null;
  amount: number | null;
  merchantRaw: string;
}

function parseTransactionRow(
  row: PdfTextRow,
  fallbackYear: number | undefined,
): ParsedRow | null {
  const text = row.text.trim();
  const dateMatch = text.match(DATE_HEAD_RE);
  if (!dateMatch) return null;

  const amountMatch = text.match(AMOUNT_TAIL_RE);
  const dateToken = dateMatch[1];
  const date = parseItalianDate(dateToken, fallbackYear);

  let amount: number | null = null;
  let merchantRaw = text.slice(dateToken.length).trim();
  if (amountMatch) {
    amount = parseItalianAmount(amountMatch[1]);
    merchantRaw = text.slice(dateToken.length, text.length - amountMatch[0].length).trim();
  }

  return { date, amount, merchantRaw };
}

function detectStatementYear(rows: PdfTextRow[]): number | undefined {
  for (const row of rows.slice(0, 40)) {
    const match = row.text.match(YEAR_IN_HEADER_RE);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

function computeExternalId(
  date: string,
  amount: number,
  merchant_raw: string,
): string {
  const canonical = `${date}|${amount.toFixed(2)}|${merchant_raw.trim().toUpperCase()}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
