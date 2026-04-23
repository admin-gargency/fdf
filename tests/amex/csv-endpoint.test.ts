import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "../../src/app/api/ingestion/amex/csv/route";
import { resetRateLimit } from "../../src/lib/ingestion/amex/rate-limit";

const FIXTURE_PATH = join(__dirname, "fixtures/csv/statement-sample.csv");
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, "utf8");

function buildRequest(
  body: FormData | string,
  headers: Record<string, string> = {},
): Request {
  if (typeof body === "string") {
    return new Request("http://localhost/api/ingestion/amex/csv", {
      method: "POST",
      body,
      headers,
    });
  }
  return new Request("http://localhost/api/ingestion/amex/csv", {
    method: "POST",
    body,
    headers,
  });
}

function csvFile(content: string, name = "statement.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("POST /api/ingestion/amex/csv", () => {
  const HOUSEHOLD = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => resetRateLimit());
  afterEach(() => resetRateLimit());

  it("rejects non-multipart content type", async () => {
    const res = await POST(
      buildRequest("hello", {
        "content-type": "text/plain",
        "x-household-id": HOUSEHOLD,
      }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects when x-household-id is missing (pre-auth gate)", async () => {
    const form = new FormData();
    form.append("file", csvFile(FIXTURE_CSV));
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthenticated");
  });

  it("rejects when file field is missing", async () => {
    const form = new FormData();
    form.append("other", "not a file");
    const res = await POST(
      buildRequest(form, { "x-household-id": HOUSEHOLD }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_file");
  });

  it("returns parsed transactions on valid Amex CSV", async () => {
    const form = new FormData();
    form.append("file", csvFile(FIXTURE_CSV));
    const res = await POST(
      buildRequest(form, { "x-household-id": HOUSEHOLD }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      format: string;
      count: number;
      transactions: Array<{ source: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.format).toBe("amex_it");
    expect(body.count).toBe(5);
    expect(body.transactions.every((t) => t.source === "amex_csv")).toBe(true);
  });

  it("returns 400 unsupported_format for non-Amex CSV", async () => {
    const form = new FormData();
    form.append(
      "file",
      csvFile("Date,Description,Amount\n2026-03-03,ESSELUNGA,45.20\n"),
    );
    const res = await POST(
      buildRequest(form, { "x-household-id": HOUSEHOLD }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unsupported_format");
  });

  it("returns 400 empty_csv for blank file", async () => {
    const form = new FormData();
    form.append("file", csvFile("   "));
    const res = await POST(
      buildRequest(form, { "x-household-id": HOUSEHOLD }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("empty_csv");
  });

  it("returns 413 when content-length exceeds 5 MB", async () => {
    const form = new FormData();
    form.append("file", csvFile(FIXTURE_CSV));
    const res = await POST(
      buildRequest(form, {
        "x-household-id": HOUSEHOLD,
        "content-length": String(6 * 1024 * 1024),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("enforces 10/hour rate limit per household", async () => {
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append("file", csvFile(FIXTURE_CSV));
      const res = await POST(
        buildRequest(form, { "x-household-id": HOUSEHOLD }),
      );
      expect(res.status).toBe(200);
    }
    const form = new FormData();
    form.append("file", csvFile(FIXTURE_CSV));
    const res = await POST(
      buildRequest(form, { "x-household-id": HOUSEHOLD }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate limit is per-household (different household unaffected)", async () => {
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append("file", csvFile(FIXTURE_CSV));
      await POST(buildRequest(form, { "x-household-id": HOUSEHOLD }));
    }
    const otherForm = new FormData();
    otherForm.append("file", csvFile(FIXTURE_CSV));
    const res = await POST(
      buildRequest(otherForm, {
        "x-household-id": "22222222-2222-2222-2222-222222222222",
      }),
    );
    expect(res.status).toBe(200);
  });
});
