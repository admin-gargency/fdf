import { detectFormat, parseCsv, type CsvFormat } from "../generic-csv";
import { AmexCsvParseError } from "./errors";
import { logAmexCsvParsed } from "./log";
import {
  normalizeMerchant,
  parseItalianAmount,
  parseItalianDate,
} from "./normalize";
import { computeExternalId } from "./shared";
import type { AmexTransaction } from "./types";

export interface AmexCsvParseOptions {
  currency?: string;
  statementYear?: number;
  onDiagnostic?: (diagnostic: AmexCsvDiagnostic) => void;
}

export interface AmexCsvDiagnostic {
  kind: "unrecognized_date" | "unrecognized_amount" | "skipped_row";
  rowIndex: number;
  rawRow: Record<string, string>;
  reason: string;
}

export interface AmexCsvParseResult {
  format: CsvFormat;
  transactions: AmexTransaction[];
  diagnostics: AmexCsvDiagnostic[];
}

export function parseAmexCsv(
  text: string,
  options: AmexCsvParseOptions = {},
): AmexCsvParseResult {
  const start = Date.now();
  if (!text || text.trim().length === 0) {
    throw new AmexCsvParseError("empty_csv", "CSV payload is empty");
  }

  const parsed = parseCsv(text);
  if (parsed.headers.length === 0) {
    throw new AmexCsvParseError("empty_csv", "CSV has no header row");
  }

  const format = detectFormat(parsed.headers);
  if (!format || format.id !== "amex_it") {
    throw new AmexCsvParseError(
      "unsupported_format",
      "Header row does not match Amex Italia portal export",
      { headers: parsed.headers },
    );
  }

  const currency = options.currency ?? "EUR";
  const diagnostics: AmexCsvDiagnostic[] = [];
  const report = (d: AmexCsvDiagnostic) => {
    diagnostics.push(d);
    options.onDiagnostic?.(d);
  };

  const txns: AmexTransaction[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const dateToken = row[format.columns.date];
    const amountToken = row[format.columns.amount];
    const descriptionToken = row[format.columns.description] ?? "";

    const date = dateToken
      ? parseItalianDate(dateToken, options.statementYear)
      : null;
    if (!date) {
      report({
        kind: "unrecognized_date",
        rowIndex: i,
        rawRow: row,
        reason: "date column missing or unparseable",
      });
      continue;
    }

    const amount = amountToken ? parseItalianAmount(amountToken) : null;
    if (amount === null) {
      report({
        kind: "unrecognized_amount",
        rowIndex: i,
        rawRow: row,
        reason: "amount column missing or unparseable",
      });
      continue;
    }

    const merchant_raw = descriptionToken.trim();
    const merchant_normalized = normalizeMerchant(merchant_raw);
    if (!merchant_normalized) {
      report({
        kind: "skipped_row",
        rowIndex: i,
        rawRow: row,
        reason: "merchant normalized to empty string",
      });
      continue;
    }

    txns.push({
      date,
      amount,
      merchant_raw,
      merchant_normalized,
      currency,
      source: "amex_csv",
      external_id: computeExternalId(date, amount, merchant_raw, i),
    });
  }

  if (txns.length === 0) {
    throw new AmexCsvParseError(
      "no_transactions_found",
      "CSV parsed but produced zero transaction rows",
      { rowsSampled: parsed.rows.length },
    );
  }

  logAmexCsvParsed({
    transactions: txns.length,
    rows: parsed.rows.length,
    separator: parsed.separator,
    durationMs: Date.now() - start,
    diagnostics: diagnostics.length,
  });

  return { format, transactions: txns, diagnostics };
}
