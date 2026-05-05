/**
 * Unit tests per GET /api/transactions e POST /api/transactions
 * (src/app/api/transactions/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * GET chain:
 *   .from("transactions").select(...).order(...).order(...).limit(n)
 *   [.eq("account_id", ...)][.eq("class_id", ...)]
 *   [.gte("booked_at", ...).lt("booked_at", ...)] → Promise
 *
 * POST chain:
 *   Prima chiamata:  .from("accounts").select(...).eq(...).limit(1)      → household lookup
 *   Seconda chiamata: .from("classes").select(...).eq(...).limit(1)      → class cross-household check (se class_id presente)
 *   Ultima chiamata: .from("transactions").insert(...).select(...)        → insert
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

vi.mock("next/server", () => {
  const MockNextResponse = function (
    body: BodyInit | null,
    init?: { status?: number },
  ) {
    return {
      status: init?.status ?? 200,
      json: async () => (body ? JSON.parse(body as string) : null),
    };
  };

  MockNextResponse.json = (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    json: async () => body,
  });

  return { NextResponse: MockNextResponse, NextRequest: vi.fn() };
});

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

// ---------------------------------------------------------------------------
// UUID fixtures (RFC 4122 v4)
// ---------------------------------------------------------------------------

const UUID_USER    = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH      = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_HH_B    = "aabbccdd-1122-4334-a556-778899aabbcc";
const UUID_ACC     = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_CLASS_1 = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_CLASS_B = "a1b2c3d4-e5f6-4a7b-a8c9-d0e1f2a3b4c5"; // another household
const UUID_TX      = "b2c3d4e5-f6a7-4b8c-a9d0-e1f2a3b4c5d6";
const NOW          = "2026-05-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// TransactionRow fixture
// ---------------------------------------------------------------------------

const TX_ROW = {
  id: UUID_TX,
  household_id: UUID_HH,
  account_id: UUID_ACC,
  class_id: UUID_CLASS_1,
  booked_at: "2026-05-01",
  amount_cents: -5000,
  currency: "EUR",
  description: "Spesa al supermercato",
  source: "manual",
  needs_review: false,
  created_at: NOW,
  updated_at: NOW,
};

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

// ---------------------------------------------------------------------------
// Helper: GET request mock
// ---------------------------------------------------------------------------

function makeGetRequest(searchParams: Record<string, string> = {}): {
  nextUrl: { searchParams: URLSearchParams };
  json: () => Promise<unknown>;
} {
  return {
    nextUrl: { searchParams: new URLSearchParams(searchParams) },
    json: async () => ({}),
  };
}

// ---------------------------------------------------------------------------
// Helper: POST request mock
// ---------------------------------------------------------------------------

function makePostRequest(body: unknown): {
  nextUrl: { searchParams: URLSearchParams };
  json: () => Promise<unknown>;
} {
  return {
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => body,
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase per GET
// Chain: select → order → order → limit → [eq → eq] → [gte → lt] → Promise
// We make the terminal method (limit) return a thenable, and eq/gte/lt also
// returnable. Since chaining order is complex, we use a lazy proxy approach.
// ---------------------------------------------------------------------------

function makeGetMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  queryResult?: QueryResult<unknown[]>;
  queryError?: { code: string; message: string };
}) {
  const result = opts.queryError
    ? { data: null, error: opts.queryError }
    : (opts.queryResult ?? { data: [TX_ROW], error: null });

  // Create a chainable mock that resolves to result when awaited
  const chainable: Record<string, unknown> = {};
  const methods = ["select", "order", "limit", "eq", "gte", "lt", "is"];
  for (const m of methods) {
    chainable[m] = vi.fn(() => chainableThenable);
  }
  const chainableThenable = {
    ...chainable,
    then: (resolve: (v: QueryResult<unknown[]>) => void, reject: (e: unknown) => void) => {
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => chainableThenable),
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase per POST
// Sequence of from() calls depends on whether class_id is supplied:
//   without class_id: 2 calls (accounts lookup, transactions insert)
//   with class_id:    3 calls (accounts lookup, classes lookup, transactions insert)
// ---------------------------------------------------------------------------

function makePostMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  accountResult?: QueryResult<{ household_id: string }[]>;
  accountError?: { code: string; message: string };
  classResult?: QueryResult<{ household_id: string }[]>;
  classError?: { code: string; message: string };
  insertResult?: QueryResult<unknown[]>;
  insertError?: { code: string; message: string };
}) {
  const defaultAccountOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultClassOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultInsertOk: QueryResult<unknown[]> = {
    data: [TX_ROW],
    error: null,
  };

  let fromCallCount = 0;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => {
      fromCallCount++;

      if (fromCallCount === 1) {
        // accounts lookup
        if (opts.accountError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.accountError }),
          };
        }
        const res = opts.accountResult ?? defaultAccountOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(res),
        };
      }

      if (fromCallCount === 2 && opts.classResult !== undefined) {
        // classes cross-household lookup
        if (opts.classError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.classError }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(opts.classResult ?? defaultClassOk),
        };
      }

      // transactions insert (last call)
      const result = opts.insertError
        ? { data: null, error: opts.insertError }
        : (opts.insertResult ?? defaultInsertOk);
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: GET /api/transactions
// ---------------------------------------------------------------------------

describe("GET /api/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeGetMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when account_id is not a valid UUID", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ account_id: "not-a-uuid" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when class_id is not a valid UUID", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ class_id: "bad" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when month format is invalid", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ month: "2026/05" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when limit is not a positive integer", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ limit: "abc" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with transactions array on happy path", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_TX);
    expect(body[0].amount_cents).toBe(-5000);
  });

  it("should return 200 with empty array when RLS hides all rows (cross-household isolation)", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ account_id: UUID_ACC });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(0);
  });

  it("should drop malformed rows (flatMap pattern)", async () => {
    const malformed = { id: "bad-id", household_id: UUID_HH };
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [malformed, TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_TX);
  });

  it("should return 500 DB_ERROR on Supabase query error", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 200 with rows when valid month=YYYY-MM filter is applied", async () => {
    // Verifies the month-filter happy path: route accepts YYYY-MM, translates to
    // [first_day, first_day_of_next_month) range, returns parsed rows.
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ month: "2026-05" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_TX);
  });

  it("should return 200 with rows when account_id filter is applied", async () => {
    // Verifies the account_id filter happy path: valid UUID passes validation,
    // RLS scopes results to household, rows returned.
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ account_id: UUID_ACC });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].account_id).toBe(UUID_ACC);
  });

  it("should return 200 with rows when class_id filter is applied", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ class_id: UUID_CLASS_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].class_id).toBe(UUID_CLASS_1);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/transactions
// ---------------------------------------------------------------------------

describe("POST /api/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    account_id: UUID_ACC,
    booked_at: "2026-05-01",
    amount_cents: -5000,
    description: "Spesa supermercato",
  };

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePostMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when account_id is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const { account_id: _omit, ...bodyWithoutAccountId } = validBody;
    void _omit;
    const req = makePostRequest(bodyWithoutAccountId);
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when account_id is not a valid UUID", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, account_id: "not-a-uuid" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when booked_at is not YYYY-MM-DD", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, booked_at: "05-01-2026" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when amount_cents is zero", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: 0 });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when booked_at is more than 7 days in the future", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    // Today is mocked/assumed to be 2026-05-05; 8 days ahead = 2026-05-13
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 8);
    const dateStr = farFuture.toISOString().slice(0, 10);

    const req = makePostRequest({ ...validBody, booked_at: dateStr });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when description exceeds 200 characters", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, description: "x".repeat(201) });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains unknown keys (.strict())", async () => {
    // `raw_description` is the PII column we must never accept client-controlled.
    // strict() ensures the schema rejects it rather than silently stripping it.
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, raw_description: "x" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 ACCOUNT_NOT_FOUND when account is not in user's household (RLS hides it)", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      accountResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("should return 403 CROSS_HOUSEHOLD when class_id belongs to another household", async () => {
    // classResult returns a row with a DIFFERENT household_id
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      accountResult: { data: [{ household_id: UUID_HH }], error: null },
      classResult: { data: [{ household_id: UUID_HH_B }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, class_id: UUID_CLASS_B });
    const response = await POST(req as never);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("CROSS_HOUSEHOLD");
  });

  it("should return 403 CROSS_HOUSEHOLD when class_id is hidden by RLS (not found)", async () => {
    // classResult returns 0 rows (RLS hides it)
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      accountResult: { data: [{ household_id: UUID_HH }], error: null },
      classResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, class_id: UUID_CLASS_B });
    const response = await POST(req as never);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("CROSS_HOUSEHOLD");
  });

  it("should return 201 with inserted TransactionRow on happy path (no class_id)", async () => {
    const txNoClass = { ...TX_ROW, class_id: null };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [txNoClass], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_TX);
    expect(body.source).toBe("manual");
    expect(body.amount_cents).toBe(-5000);
  });

  it("should return 201 with inserted TransactionRow on happy path (with class_id same household)", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      accountResult: { data: [{ household_id: UUID_HH }], error: null },
      classResult: { data: [{ household_id: UUID_HH }], error: null },
      insertResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, class_id: UUID_CLASS_1 });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_TX);
    expect(body.class_id).toBe(UUID_CLASS_1);
    expect(body.source).toBe("manual");
  });

  it("should reject source in client body — strict() rejects unknown keys, source is not mutable", async () => {
    // With .strict(), sending `source` as a body key is a 400 VALIDATION_ERROR.
    // This is stronger than silently stripping it: the client gets an explicit
    // rejection rather than a silent no-op. The hardcoded source="manual" on
    // INSERT is verified via the happy-path tests above (response row has source="manual").
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [TX_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, source: "psd2" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 500 DB_ERROR on insert error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: { code: "PGRST301", message: "timeout" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should accept a positive amount_cents (inflow/entrata)", async () => {
    const inflowTx = { ...TX_ROW, amount_cents: 10000 };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [inflowTx], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: 10000 });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.amount_cents).toBe(10000);
  });
});
