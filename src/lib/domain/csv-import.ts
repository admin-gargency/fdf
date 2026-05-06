/**
 * csv-import.ts — Pure domain logic for CSV transaction import.
 *
 * Supported formats:
 *   - Fineco Bank export (columns: Data Contabile, Data Valuta, Entrate,
 *     Uscite, Causale, Descrizione)
 *   - Generic CSV with caller-provided column mapping
 *
 * Sign convention (mirrors core_schema.sql L161 and transactions.ts):
 *   amount_cents > 0  →  inflow  (entrata)
 *   amount_cents < 0  →  outflow (spesa)
 *
 * CSV injection note: formula characters (=, +, -, @, |, etc.) are NOT
 * sanitised here — that is a rendering/export concern. The domain layer
 * preserves raw data as-is. Downstream sanitisation is tracked in
 * security-reviewer task FDFA-62.
 *
 * Ownership: domain-dev (AGENTS.md §File ownership convention).
 * Consumed by: src/app/api/transactions/import/route.ts (backend-dev).
 *
 * NEVER include: DB calls, Next.js imports, Supabase clients, I/O.
 * NEVER log: description, raw_description, amount values (PII / PCI risk).
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseCsv,
  stripBom,
} from "../ingestion/generic-csv";
import { parseItalianAmount } from "../ingestion/amex/normalize";

// ---------------------------------------------------------------------------
// ParseError — per-row error with line number and optional field name
// ---------------------------------------------------------------------------

/**
 * A non-fatal per-row error encountered during CSV parsing.
 * Errors are collected in the `errors` array returned by each parser;
 * the row is skipped but parsing continues.
 */
export interface ParseError {
  /** 1-based line number in the CSV file (line 1 = header). */
  line: number;
  /** Column name that caused the error, if applicable. */
  field?: string;
  /** Human-readable error message in Italian (user-facing). */
  message: string;
}

// ---------------------------------------------------------------------------
// CsvParseError — fatal structural error (thrown, not collected)
// ---------------------------------------------------------------------------

/**
 * Thrown when the CSV is structurally invalid and parsing cannot begin
 * (e.g. missing required header columns).
 */
export class CsvParseError extends Error {
  constructor(public readonly errors: ParseError[]) {
    super(errors.map((e) => `Riga ${e.line}: ${e.message}`).join("; "));
    this.name = "CsvParseError";
  }
}

// ---------------------------------------------------------------------------
// CsvImportRowSchema — Zod schema for a single normalised import row
// ---------------------------------------------------------------------------

/**
 * Schema for a single row ready for upsert into `public.transactions`.
 *
 * - `amount_cents`: signed integer; positive = inflow, negative = outflow.
 *   Convention aligns with core_schema.sql L161 and z.number().int() (the
 *   repo convention — Supabase JS serialises Postgres bigint as JS number).
 * - `external_id`: SHA-256-based dedup key; generated via
 *   {@link generateExternalId} after parsing. Partial unique index:
 *   (account_id, external_id) WHERE external_id IS NOT NULL.
 * - `raw_description`: original CSV row text for audit/PII trail; written
 *   only via service-role client (no GRANT to anon/authenticated — see
 *   grants.sql L120-125).
 * - `class_id`: always null from CSV import — classification is a
 *   post-import step (manual or rule-based).
 */
export const CsvImportRowSchema = z
  .object({
    account_id: z.string().uuid(),
    booked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato data non valido (atteso YYYY-MM-DD)"),
    amount_cents: z
      .number()
      .int()
      .refine((v) => v !== 0, "l'importo non può essere zero"),
    description: z.string().max(500),
    /** Descrizione originale della riga CSV — PII-sensitive, solo service role. */
    raw_description: z.string().max(500).optional(),
    class_id: z.string().uuid().nullable(),
    /** SHA-256 dedup key — generato da generateExternalId, mai dall'utente. */
    external_id: z.string().max(200).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  })
  .strict();

/** TypeScript type inferred from {@link CsvImportRowSchema}. */
export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;

// ---------------------------------------------------------------------------
// GenericColumnMap — caller-provided column mapping for parseGenericCSV
// ---------------------------------------------------------------------------

/**
 * Maps CSV column names to domain fields for {@link parseGenericCSV}.
 * All column names are case-sensitive and must match the CSV header exactly.
 */
export interface GenericColumnMap {
  /** CSV column name for `booked_at` (transaction date). */
  date: string;
  /**
   * CSV column name for `amount_cents`.
   * Values may be positive (inflow) or negative (outflow).
   * Italian decimal separator (",") is normalised automatically.
   */
  amount: string;
  /** CSV column name for `description`. */
  description: string;
  /**
   * Optional CSV column name for a category hint.
   * Currently unused in domain logic; reserved for future rule-based
   * classification.
   */
  category?: string;
}

// ---------------------------------------------------------------------------
// generateExternalId — SHA-256 dedup key
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic dedup key for a transaction row using
 * SHA-256 of a normalised canonical string.
 *
 * The `account_id` is included in the hash so that two accounts with
 * identical date/amount/description produce different external_ids,
 * keeping the partial unique index `(account_id, external_id)` correct.
 *
 * Returns the first 40 hex characters of the digest (collision probability
 * is negligible at realistic household import sizes, e.g. O(50 k rows)).
 *
 * @param input - Canonical fields identifying the transaction.
 * @returns 40-character hex string.
 */
export function generateExternalId(input: {
  account_id: string;
  booked_at: string;
  amount_cents: number;
  description: string;
}): string {
  const normalised = [
    input.account_id,
    input.booked_at,
    String(input.amount_cents),
    input.description.toLowerCase().trim(),
  ].join("|");
  return createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a Fineco-style date string "DD/MM/YYYY" into "YYYY-MM-DD".
 * Returns `null` if the format does not match or the date is invalid.
 */
function parseFinecoDate(token: string): string | null {
  const m = token.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Use Date.UTC to validate calendar correctness (avoids JS local-TZ drift).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Tries to parse a date string in multiple formats:
 *   1. YYYY-MM-DD (ISO)
 *   2. DD/MM/YYYY (Italian / Fineco)
 *   3. MM/DD/YYYY (US)
 *
 * Returns the ISO "YYYY-MM-DD" string, or `null` if no format matches.
 */
function parseGenericDate(token: string): string | null {
  const trimmed = token.trim();

  // 1. ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) {
      return trimmed;
    }
    return null;
  }

  // 2. DD/MM/YYYY (Italian)
  const ddMmYyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddMmYyyy) {
    const day = parseInt(ddMmYyyy[1], 10);
    const month = parseInt(ddMmYyyy[2], 10);
    const year = parseInt(ddMmYyyy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (
        d.getUTCFullYear() === year &&
        d.getUTCMonth() === month - 1 &&
        d.getUTCDate() === day
      ) {
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  // 3. MM/DD/YYYY (US)
  const mmDdYyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mmDdYyyy) {
    const month = parseInt(mmDdYyyy[1], 10);
    const day = parseInt(mmDdYyyy[2], 10);
    const year = parseInt(mmDdYyyy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (
        d.getUTCFullYear() === year &&
        d.getUTCMonth() === month - 1 &&
        d.getUTCDate() === day
      ) {
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  return null;
}

/**
 * Converts a decimal amount value (possibly containing Italian separators)
 * to integer cents. Returns `null` on parse failure.
 *
 * Uses `parseItalianAmount` from the ingestion normalize utility which
 * handles comma/dot separators, sign prefixes, currency symbols, and
 * parenthetical negatives.
 *
 * The result is rounded to avoid floating-point drift (e.g. 10.005 * 100).
 */
function amountToCents(token: string): number | null {
  // parseItalianAmount returns the value in euros (float), signed.
  const euros = parseItalianAmount(token);
  if (euros === null) return null;
  return Math.round(euros * 100);
}

/**
 * Reconstructs the raw CSV line from a parsed row Record for `raw_description`.
 * Joins values with comma — sufficient for audit purposes; not a perfect
 * round-trip for complex quoted fields.
 */
function buildRawDescription(row: Record<string, string>): string {
  return Object.values(row).join(",").slice(0, 500);
}

// ---------------------------------------------------------------------------
// parseFinecoCSV — Fineco Bank export parser
// ---------------------------------------------------------------------------

/** Fineco CSV required column names. */
const FINECO_COLS = {
  dataContabile: "Data Contabile",
  dataValuta: "Data Valuta",
  entrate: "Entrate",
  uscite: "Uscite",
  causale: "Causale",
  descrizione: "Descrizione",
} as const;

/**
 * Parses a Fineco Bank CSV export into normalised import rows.
 *
 * Expected column headers (case-sensitive):
 *   Data Contabile, Data Valuta, Entrate, Uscite, Causale, Descrizione
 *
 * Behaviour:
 *   - UTF-8 BOM is stripped silently.
 *   - Missing required headers → throws {@link CsvParseError}.
 *   - Empty file / header-only → returns `{ rows: [], errors: [] }`.
 *   - Invalid date on a row → non-fatal error, row skipped.
 *   - Zero amount (both Entrate and Uscite absent/zero) → warning, row skipped.
 *   - All amounts are converted to integer cents (no floats).
 *
 * @param csvText  - Raw CSV string (UTF-8, optionally BOM-prefixed).
 * @param opts     - `account_id` UUID applied to every row.
 * @returns Object with `rows` (valid {@link CsvImportRow}[]) and
 *          `errors` (non-fatal {@link ParseError}[]).
 * @throws {@link CsvParseError} on structural errors (bad headers).
 */
export function parseFinecoCSV(
  csvText: string,
  opts: { account_id: string },
): { rows: CsvImportRow[]; errors: ParseError[] } {
  // parseCsv internally calls stripBom, normalises CRLF, skips blank lines.
  const parsed = parseCsv(csvText);

  // Empty file.
  if (parsed.headers.length === 0) {
    return { rows: [], errors: [] };
  }

  // Validate required headers.
  const requiredCols = Object.values(FINECO_COLS);
  const missingCols = requiredCols.filter((col) => !parsed.headers.includes(col));
  if (missingCols.length > 0) {
    throw new CsvParseError([
      {
        line: 1,
        message: `Intestazione CSV non valida. Colonne mancanti: ${missingCols.join(", ")}`,
      },
    ]);
  }

  // Header-only file.
  if (parsed.rows.length === 0) {
    return { rows: [], errors: [] };
  }

  const rows: CsvImportRow[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    // Line number: header = 1, first data row = 2.
    const lineNum = i + 2;

    // Parse booked_at from "Data Contabile" (DD/MM/YYYY).
    const dateToken = row[FINECO_COLS.dataContabile] ?? "";
    const booked_at = parseFinecoDate(dateToken);
    if (!booked_at) {
      errors.push({
        line: lineNum,
        field: FINECO_COLS.dataContabile,
        message: `Data contabile non valida: "${dateToken}". Formato atteso: GG/MM/AAAA`,
      });
      continue;
    }

    // Determine amount_cents from Entrate / Uscite columns.
    const entrateToken = row[FINECO_COLS.entrate] ?? "";
    const usciteToken = row[FINECO_COLS.uscite] ?? "";

    let amount_cents: number | null = null;

    if (entrateToken.trim() && entrateToken.trim() !== "0") {
      const entrateCents = amountToCents(entrateToken);
      if (entrateCents !== null && entrateCents > 0) {
        amount_cents = entrateCents; // positive = inflow
      }
    }

    if (amount_cents === null && usciteToken.trim() && usciteToken.trim() !== "0") {
      const usciteCents = amountToCents(usciteToken);
      if (usciteCents !== null && usciteCents > 0) {
        amount_cents = -usciteCents; // negative = outflow
      }
    }

    if (amount_cents === null || amount_cents === 0) {
      errors.push({
        line: lineNum,
        field: "Entrate/Uscite",
        message: "Riga saltata: importo assente o pari a zero",
      });
      continue;
    }

    // Build description from Causale + Descrizione, truncated to 500 chars.
    const causale = row[FINECO_COLS.causale]?.trim() ?? "";
    const descrizione = row[FINECO_COLS.descrizione]?.trim() ?? "";
    const description = `${causale} - ${descrizione}`.slice(0, 500);

    // Raw description: original CSV values joined (audit/PII trail).
    const raw_description = buildRawDescription(row);

    // Generate deterministic dedup key.
    const external_id = generateExternalId({
      account_id: opts.account_id,
      booked_at,
      amount_cents,
      description,
    });

    const importRow: CsvImportRow = {
      account_id: opts.account_id,
      booked_at,
      amount_cents,
      description,
      raw_description,
      class_id: null,
      external_id,
      currency: "EUR",
    };

    rows.push(importRow);
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// parseGenericCSV — generic CSV parser with caller-provided column mapping
// ---------------------------------------------------------------------------

/**
 * Parses a generic CSV export using a caller-provided column mapping.
 *
 * Column names in `columnMap` must match the CSV header exactly
 * (case-sensitive). The CSV separator is auto-detected (comma, semicolon,
 * or tab).
 *
 * Date parsing order: YYYY-MM-DD → DD/MM/YYYY → MM/DD/YYYY.
 * Amount: parsed as float, Italian comma separator normalised to dot,
 *   then converted to integer cents.
 * Sign: positive amount → inflow; negative → outflow.
 *
 * @param csvText   - Raw CSV string (UTF-8, optionally BOM-prefixed).
 * @param opts      - `account_id` UUID and {@link GenericColumnMap}.
 * @returns Object with `rows` and `errors`.
 * @throws {@link CsvParseError} if required columns are missing from header.
 */
export function parseGenericCSV(
  csvText: string,
  opts: { account_id: string; columnMap: GenericColumnMap },
): { rows: CsvImportRow[]; errors: ParseError[] } {
  const { account_id, columnMap } = opts;

  const parsed = parseCsv(csvText);

  // Empty file.
  if (parsed.headers.length === 0) {
    return { rows: [], errors: [] };
  }

  // Validate required columns.
  const requiredCols = [columnMap.date, columnMap.amount, columnMap.description];
  const missingCols = requiredCols.filter((col) => !parsed.headers.includes(col));
  if (missingCols.length > 0) {
    throw new CsvParseError([
      {
        line: 1,
        message: `Intestazione CSV non valida. Colonne mancanti: ${missingCols.join(", ")}`,
      },
    ]);
  }

  // Header-only file.
  if (parsed.rows.length === 0) {
    return { rows: [], errors: [] };
  }

  const rows: CsvImportRow[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const lineNum = i + 2; // header = line 1, first data row = line 2

    // Parse date.
    const dateToken = row[columnMap.date] ?? "";
    const booked_at = parseGenericDate(dateToken);
    if (!booked_at) {
      errors.push({
        line: lineNum,
        field: columnMap.date,
        message: `Data non valida: "${dateToken}". Formati supportati: AAAA-MM-GG, GG/MM/AAAA, MM/GG/AAAA`,
      });
      continue;
    }

    // Parse amount.
    const amountToken = row[columnMap.amount] ?? "";
    const amount_cents = amountToCents(amountToken);
    if (amount_cents === null) {
      errors.push({
        line: lineNum,
        field: columnMap.amount,
        message: `Importo non valido: "${amountToken}"`,
      });
      continue;
    }
    if (amount_cents === 0) {
      errors.push({
        line: lineNum,
        field: columnMap.amount,
        message: "Riga saltata: importo pari a zero",
      });
      continue;
    }

    // Build description, truncated to 500 chars.
    const description = (row[columnMap.description] ?? "").trim().slice(0, 500);

    // Raw description for audit.
    const raw_description = buildRawDescription(row);

    // Generate dedup key.
    const external_id = generateExternalId({
      account_id,
      booked_at,
      amount_cents,
      description,
    });

    const importRow: CsvImportRow = {
      account_id,
      booked_at,
      amount_cents,
      description,
      raw_description,
      class_id: null,
      external_id,
      currency: "EUR",
    };

    rows.push(importRow);
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Re-export stripBom for consumers that need BOM stripping pre-parse
// ---------------------------------------------------------------------------

export { stripBom };
