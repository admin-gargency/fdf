import { NextResponse } from "next/server";

import { parseAmexCsv } from "@/lib/ingestion/amex/csv";
import { AmexCsvParseError } from "@/lib/ingestion/amex/errors";
import { hitRateLimit } from "@/lib/ingestion/amex/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_FILE_CONTENT_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/plain",
]);

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return jsonError(415, "unsupported_content_type", {
      expected: "multipart/form-data",
    });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return jsonError(413, "payload_too_large", { maxBytes: MAX_BYTES });
  }

  const householdId = resolveHouseholdIdForDev(req);
  if (!householdId) {
    return jsonError(401, "unauthenticated", {
      hint: "session-authenticated Supabase client not yet wired; temporarily gated by x-household-id header (dev only, tracked in FDFA-9d)",
    });
  }

  const rateLimit = hitRateLimit(`amex-csv:${householdId}`);
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        ),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, "invalid_multipart");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "missing_file", { field: "file" });
  }
  if (file.size === 0) {
    return jsonError(400, "empty_file");
  }
  if (file.size > MAX_BYTES) {
    return jsonError(413, "payload_too_large", { maxBytes: MAX_BYTES });
  }

  const fileType = file.type.toLowerCase();
  if (fileType && !ALLOWED_FILE_CONTENT_TYPES.has(fileType)) {
    return jsonError(415, "unsupported_content_type", {
      received: fileType,
      allowed: [...ALLOWED_FILE_CONTENT_TYPES],
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = buffer.toString("utf8");

  try {
    const { transactions, format, diagnostics } = parseAmexCsv(text);
    return NextResponse.json({
      ok: true,
      format: format.id,
      count: transactions.length,
      diagnostics: diagnostics.length,
      transactions,
    });
  } catch (err) {
    if (err instanceof AmexCsvParseError) {
      return NextResponse.json(
        { error: err.code, message: err.message, context: err.context },
        { status: 400 },
      );
    }
    console.error(
      JSON.stringify({
        event: "amex.csv.unexpected_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return jsonError(500, "internal");
  }
}

function jsonError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return NextResponse.json({ error: code, ...extra }, { status });
}

function resolveHouseholdIdForDev(req: Request): string | null {
  const headerValue = req.headers.get("x-household-id");
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  return null;
}
