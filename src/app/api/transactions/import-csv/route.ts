/**
 * POST /api/transactions/import-csv
 *
 * Bulk-imports transactions from a CSV file (Fineco or generic format)
 * into `public.transactions` for the authenticated user's household.
 *
 * Content-Type: multipart/form-data
 * Fields:
 *   file          — CSV file (max 5 MB, .csv or .txt)
 *   account_id    — UUID of the target account
 *   format        — "fineco" | "generic"
 *   column_map    — JSON string (GenericColumnMap), required only if format=generic
 *   auto_categorize — boolean string, accepted and ignored (F9+ scope)
 *
 * Auth model:
 *   1. SSR client   → getUser()          (session validation)
 *   2. SSR client   → SELECT accounts    (ownership via RLS)
 *   3. Admin client → upsert transactions (external_id + raw_description need
 *                                          service role — outside authenticated GRANT)
 *
 * Dedupe: upsert with onConflict="account_id,external_id" + ignoreDuplicates=true.
 * Partial unique index: uq_transactions_account_external (account_id, external_id)
 * WHERE external_id IS NOT NULL — PostgREST respects partial indexes natively.
 *
 * Chunk size: 500 rows per upsert call (conservative PostgREST payload guard;
 * ~100 KB JSON per chunk at avg 200 bytes/row, well under the 10 MB default limit).
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 * Related tasks: FDFA-59 (this), FDFA-58 (domain-dev csv-import.ts), FDFA-61 (tests).
 * Security audit: FDFA-62 (CSV injection risk — delegated to security-reviewer).
 *
 * GDPR / PII:
 *   - No console.log of description, raw_description, or amount values.
 *   - Log only: { event, userId, rowCount, errorCount, code }.
 *   - raw_description is written to DB via service role but never logged.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/lib/ingestion/amex/rate-limit";
import {
  parseFinecoCSV,
  parseGenericCSV,
  CsvParseError,
  type GenericColumnMap,
  type CsvImportRow,
  type ParseError,
} from "@/lib/domain/csv-import";

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Rows per upsert chunk — conservative PostgREST payload guard. */
const UPSERT_CHUNK_SIZE = 500;

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
]);

// ---------------------------------------------------------------------------
// Request validation schemas
// ---------------------------------------------------------------------------

const FormatEnum = z.enum(["fineco", "generic"]);

const GenericColumnMapSchema = z.object({
  date: z.string().min(1),
  amount: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
}) satisfies z.ZodType<GenericColumnMap>;

// ---------------------------------------------------------------------------
// Helper — DB row shape for admin upsert
// ---------------------------------------------------------------------------

interface TransactionInsertRow {
  household_id: string;
  account_id: string;
  class_id: null;
  booked_at: string;
  amount_cents: number;
  currency: string;
  description: string;
  raw_description: string | undefined;
  external_id: string | undefined;
  source: "import_csv";
  needs_review: true;
  created_by: string;
}

// ---------------------------------------------------------------------------
// Helper — chunk array into fixed-size slices
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Helper — JSON error response (aligns with F3-F6 error taxonomy)
// ---------------------------------------------------------------------------

function jsonError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: code, code, ...extra }, { status });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  // ------------------------------------------------------------------
  // Step 1 — Init SSR client
  // ------------------------------------------------------------------
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return jsonError(500, "INIT_ERROR");
  }

  // ------------------------------------------------------------------
  // Step 2 — Authenticate user
  // ------------------------------------------------------------------
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return jsonError(401, "UNAUTHENTICATED");
  }

  const userId = userData.user.id;

  // ------------------------------------------------------------------
  // Step 3 — Rate limit (10 imports / 1 h per user, in-memory per instance)
  // Note: Vercel multi-instance means each instance has its own bucket.
  // Acceptable pre-launch (low replica count at this traffic level).
  // ------------------------------------------------------------------
  const rl = hitRateLimit(`import-csv:${userId}`);
  if (!rl.ok) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((rl.resetAt - Date.now()) / 1000),
    );
    return NextResponse.json(
      { error: "RATE_LIMIT_EXCEEDED", code: "RATE_LIMIT_EXCEEDED" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  // ------------------------------------------------------------------
  // Step 4 — Validate Content-Type
  // ------------------------------------------------------------------
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError(415, "UNSUPPORTED_CONTENT_TYPE", {
      expected: "multipart/form-data",
    });
  }

  // Fast-path size check via Content-Length header (before parsing multipart).
  const contentLength = parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", { maxBytes: MAX_BYTES });
  }

  // ------------------------------------------------------------------
  // Step 5 — Parse multipart form data
  // ------------------------------------------------------------------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "VALIDATION_ERROR", {
      message: "Could not parse multipart/form-data body",
    });
  }

  // ------------------------------------------------------------------
  // Step 6 — Validate file field
  // ------------------------------------------------------------------
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "MISSING_FILE", { field: "file" });
  }
  if (file.size === 0) {
    return jsonError(400, "EMPTY_FILE");
  }
  if (file.size > MAX_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", { maxBytes: MAX_BYTES });
  }

  // MIME check (permissive: browsers sometimes omit or mis-report MIME for .csv).
  const mimeType = file.type.toLowerCase().split(";")[0].trim();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return jsonError(400, "INVALID_FILE_TYPE", {
      received: mimeType,
      allowed: [...ALLOWED_MIME_TYPES],
    });
  }

  // Extension check (.csv or .txt).
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".csv") && !fileName.endsWith(".txt")) {
    return jsonError(400, "INVALID_FILE_TYPE", {
      message: "File must have .csv or .txt extension",
      received: file.name,
    });
  }

  // ------------------------------------------------------------------
  // Step 7 — Validate form fields (account_id, format, column_map)
  // ------------------------------------------------------------------
  const rawAccountId = formData.get("account_id");
  const rawFormat = formData.get("format");
  const rawColumnMap = formData.get("column_map");
  const rawAutoCategorize = formData.get("auto_categorize");

  // account_id — required UUID
  const accountIdResult = z.string().uuid().safeParse(rawAccountId);
  if (!accountIdResult.success) {
    return jsonError(400, "VALIDATION_ERROR", {
      message: "account_id must be a valid UUID",
      field: "account_id",
    });
  }
  const accountId = accountIdResult.data;

  // format — required enum
  const formatResult = FormatEnum.safeParse(rawFormat);
  if (!formatResult.success) {
    return jsonError(400, "VALIDATION_ERROR", {
      message: 'format must be "fineco" or "generic"',
      field: "format",
    });
  }
  const format = formatResult.data;

  // column_map — required when format=generic, silently ignored for fineco
  let columnMap: GenericColumnMap | undefined;
  if (format === "generic") {
    if (!rawColumnMap || typeof rawColumnMap !== "string") {
      return jsonError(400, "VALIDATION_ERROR", {
        message: "column_map is required when format is generic",
        field: "column_map",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawColumnMap);
    } catch {
      return jsonError(400, "VALIDATION_ERROR", {
        message: "column_map must be valid JSON",
        field: "column_map",
      });
    }
    const cmResult = GenericColumnMapSchema.safeParse(parsed);
    if (!cmResult.success) {
      return jsonError(400, "VALIDATION_ERROR", {
        message: "column_map has invalid shape",
        field: "column_map",
        issues: cmResult.error.issues,
      });
    }
    columnMap = cmResult.data;
  }

  // auto_categorize — accepted and ignored (F9+ scope)
  if (rawAutoCategorize !== null) {
    console.log(
      JSON.stringify({
        event: "import_csv.auto_categorize_ignored",
        userId,
      }),
    );
  }

  // ------------------------------------------------------------------
  // Step 8 — Verify account ownership via SSR client (RLS guards cross-household)
  // ------------------------------------------------------------------
  const { data: accountRows, error: accountError } = await supabase
    .from("accounts")
    .select("household_id")
    .eq("id", accountId)
    .limit(1);

  if (accountError) {
    console.error(
      JSON.stringify({
        event: "import_csv.account_lookup_error",
        userId,
        code: accountError.code,
      }),
    );
    return jsonError(500, "INIT_ERROR");
  }

  if (!accountRows || accountRows.length === 0) {
    return jsonError(404, "ACCOUNT_NOT_FOUND", {
      message: "Account not found or does not belong to your household",
    });
  }

  const householdId = accountRows[0].household_id as string;

  // ------------------------------------------------------------------
  // Step 9 — Read file content (UTF-8; BOM handled by domain parsers)
  // ------------------------------------------------------------------
  const csvText = await file.text();

  // ------------------------------------------------------------------
  // Step 10 — Parse CSV via domain layer
  // ------------------------------------------------------------------
  let parsedRows: CsvImportRow[];
  let parseErrors: ParseError[];

  try {
    if (format === "fineco") {
      const result = parseFinecoCSV(csvText, { account_id: accountId });
      parsedRows = result.rows;
      parseErrors = result.errors;
    } else {
      // format === "generic" — columnMap is guaranteed by earlier validation
      const result = parseGenericCSV(csvText, {
        account_id: accountId,
        columnMap: columnMap!,
      });
      parsedRows = result.rows;
      parseErrors = result.errors;
    }
  } catch (err) {
    if (err instanceof CsvParseError) {
      return NextResponse.json(
        {
          error: "CSV_PARSE_ERROR",
          code: "CSV_PARSE_ERROR",
          errors: err.errors,
        },
        { status: 400 },
      );
    }
    console.error(
      JSON.stringify({
        event: "import_csv.parse_unexpected_error",
        userId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return jsonError(500, "INSERT_ERROR");
  }

  // No valid rows to insert — return early with any non-fatal errors.
  if (parsedRows.length === 0) {
    return NextResponse.json(
      {
        imported: 0,
        skipped: 0,
        errors: parseErrors,
      },
      { status: 201 },
    );
  }

  // ------------------------------------------------------------------
  // Step 11 — Enrich rows with server-derived fields
  // ------------------------------------------------------------------
  const enrichedRows: TransactionInsertRow[] = parsedRows.map((row) => ({
    household_id: householdId,
    account_id: row.account_id,
    class_id: null,
    booked_at: row.booked_at,
    amount_cents: row.amount_cents,
    currency: row.currency ?? "EUR",
    description: row.description,
    raw_description: row.raw_description,
    external_id: row.external_id,
    source: "import_csv" as const,
    needs_review: true as const,
    created_by: userId,
  }));

  // ------------------------------------------------------------------
  // Step 12 — Admin client (service role — bypasses RLS and GRANT limits)
  // required because external_id, raw_description, created_by are outside
  // the authenticated GRANT INSERT on public.transactions.
  // ------------------------------------------------------------------
  const admin = getAdminClient();
  if (!admin) {
    return jsonError(500, "INIT_ERROR");
  }

  // ------------------------------------------------------------------
  // Step 13 — Bulk upsert in chunks of UPSERT_CHUNK_SIZE
  // onConflict targets the partial unique index uq_transactions_account_external:
  //   CREATE UNIQUE INDEX ... ON public.transactions (account_id, external_id)
  //   WHERE external_id IS NOT NULL;
  // ignoreDuplicates=true → DO NOTHING on conflict (no overwrite of existing rows).
  // Fallback if ignoreDuplicates is rejected at runtime: pre-fetch existing
  // external_ids and filter client-side before a plain .insert() call.
  // ------------------------------------------------------------------
  const chunks = chunkArray(enrichedRows, UPSERT_CHUNK_SIZE);
  let totalImported = 0;
  let totalSkipped = 0;

  for (const chunk of chunks) {
    const { data: upsertedRows, error: upsertError } = await admin
      .from("transactions")
      .upsert(chunk, {
        onConflict: "account_id,external_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (upsertError) {
      console.error(
        JSON.stringify({
          event: "import_csv.upsert_error",
          userId,
          code: upsertError.code,
          chunkSize: chunk.length,
        }),
      );
      return jsonError(500, "INSERT_ERROR");
    }

    const insertedCount = upsertedRows?.length ?? 0;
    totalImported += insertedCount;
    totalSkipped += chunk.length - insertedCount;
  }

  // ------------------------------------------------------------------
  // Step 14 — Success response
  // ------------------------------------------------------------------
  console.log(
    JSON.stringify({
      event: "import_csv.success",
      userId,
      rowCount: enrichedRows.length,
      imported: totalImported,
      skipped: totalSkipped,
      errorCount: parseErrors.length,
    }),
  );

  return NextResponse.json(
    {
      imported: totalImported,
      skipped: totalSkipped,
      errors: parseErrors,
    },
    { status: 201 },
  );
}
