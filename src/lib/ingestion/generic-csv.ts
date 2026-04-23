export type CsvSeparator = "," | ";" | "\t";

export interface CsvParseOptions {
  separator?: CsvSeparator;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  separator: CsvSeparator;
}

export interface CsvFormat {
  id: string;
  columns: {
    date: string;
    amount: string;
    description: string;
    postingDate?: string;
    category?: string;
  };
}

const UTF8_BOM = "﻿";

const FORMATS: CsvFormat[] = [
  {
    id: "amex_it",
    columns: {
      date: "Data",
      postingDate: "Data di registrazione",
      description: "Descrizione",
      amount: "Importo",
      category: "Categoria Amex",
    },
  },
];

export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

export function detectSeparator(headerLine: string): CsvSeparator {
  const counts: Record<CsvSeparator, number> = {
    ",": countOutsideQuotes(headerLine, ","),
    ";": countOutsideQuotes(headerLine, ";"),
    "\t": countOutsideQuotes(headerLine, "\t"),
  };
  let best: CsvSeparator = ",";
  let bestCount = counts[","];
  for (const sep of [";", "\t"] as CsvSeparator[]) {
    if (counts[sep] > bestCount) {
      best = sep;
      bestCount = counts[sep];
    }
  }
  return best;
}

export function parseCsv(
  text: string,
  options: CsvParseOptions = {},
): ParsedCsv {
  const normalized = stripBom(text).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], separator: options.separator ?? "," };
  }
  const separator = options.separator ?? detectSeparator(lines[0]);
  const headers = splitCsvLine(lines[0], separator).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = splitCsvLine(lines[i], separator);
    if (raw.every((v) => v.trim().length === 0)) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (raw[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows, separator };
}

export function detectFormat(headers: string[]): CsvFormat | null {
  const lowered = new Set(headers.map((h) => h.toLowerCase()));
  for (const format of FORMATS) {
    const required = [
      format.columns.date,
      format.columns.description,
      format.columns.amount,
    ];
    if (required.every((col) => lowered.has(col.toLowerCase()))) {
      return format;
    }
  }
  return null;
}

export function listFormats(): readonly CsvFormat[] {
  return FORMATS;
}

function splitCsvLine(line: string, separator: CsvSeparator): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function countOutsideQuotes(line: string, ch: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && c === ch) {
      count++;
    }
  }
  return count;
}
