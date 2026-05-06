/**
 * Integration tests for GET /api/budgets and POST /api/budgets
 * (src/app/api/budgets/route.ts)
 *
 * Strategy: lightweight mock of src/lib/supabase/server.ts to simulate
 * Supabase responses without a real DB.
 *
 * GET chain:
 *   .from("budgets").select(...).order(...).order(...)
 *   [.gte("period", ...).lt("period", ...)] → Promise
 *
 * POST chain:
 *   Call 1: .from("classes").select(...).eq(...).limit(1)   → class/household lookup
 *   Call 2: .from("budgets").upsert(...).select(...)        → upsert
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

const UUID_USER     = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH       = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_CLASS_1  = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_BUDGET_1 = "b2c3d4e5-f6a7-4b8c-a9d0-e1f2a3b4c5d6";
const NOW           = "2026-05-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Budget row fixture (valid BudgetRow shape)
// ---------------------------------------------------------------------------

const BUDGET_ROW = {
  id: UUID_BUDGET_1,
  household_id: UUID_HH,
  class_id: UUID_CLASS_1,
  period: "2026-05-01",
  amount_cents: 50000,
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
// Helper: mock Supabase for GET
// Chain: from("budgets").select(...).order(...).order(...)[.gte(...).lt(...)] → Promise
// Uses a chainable proxy that resolves to the provided result when awaited.
// ---------------------------------------------------------------------------

function makeGetMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  queryResult?: QueryResult<unknown[]>;
  queryError?: { code: string; message: string };
}) {
  const result = opts.queryError
    ? { data: null, error: opts.queryError }
    : (opts.queryResult ?? { data: [BUDGET_ROW], error: null });

  const chainable: Record<string, unknown> = {};
  const methods = ["select", "order", "limit", "eq", "gte", "lt"];
  for (const m of methods) {
    chainable[m] = vi.fn(() => chainableThenable);
  }
  const chainableThenable = {
    ...chainable,
    then: (
      resolve: (v: QueryResult<unknown[]>) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
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
// Helper: mock Supabase for POST
// Sequence of from() calls:
//   Call 1: .from("classes").select(...).eq(...).limit(1)  → class/household lookup
//   Call 2: .from("budgets").upsert(...).select(...)       → upsert
// ---------------------------------------------------------------------------

function makePostMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  classResult?: QueryResult<{ household_id: string }[]>;
  classError?: { code: string; message: string };
  upsertResult?: QueryResult<unknown[]>;
  upsertError?: { code: string; message: string };
}) {
  const defaultClassOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultUpsertOk: QueryResult<unknown[]> = {
    data: [BUDGET_ROW],
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
        // classes lookup
        if (opts.classError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.classError }),
          };
        }
        const res = opts.classResult ?? defaultClassOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(res),
        };
      }

      // budgets upsert (second call)
      const result = opts.upsertError
        ? { data: null, error: opts.upsertError }
        : (opts.upsertResult ?? defaultUpsertOk);
      return {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: GET /api/budgets
// ---------------------------------------------------------------------------

describe("GET /api/budgets", () => {
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

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makeGetMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when period is malformed: single-digit month", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ period: "2026-5" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when period is completely invalid", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ period: "abc" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when period is full date (YYYY-MM-DD)", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ period: "2026-05-01" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with budgets array (no period filter)", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [BUDGET_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_BUDGET_1);
    expect(body[0].amount_cents).toBe(50000);
  });

  it("should return 200 with valid YYYY-MM period filter applied", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [BUDGET_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ period: "2026-05" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].period).toBe("2026-05-01");
  });

  it("should return 200 with empty array when no budgets found", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(0);
  });

  it("should silently drop malformed rows (flatMap pattern)", async () => {
    const malformed = { id: "bad-id", household_id: UUID_HH };
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [malformed, BUDGET_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_BUDGET_1);
  });

  it("should return 500 FETCH_ERROR on Supabase query error", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("FETCH_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should apply gte/lt range when period filter is provided (December wraparound)", async () => {
    // Verifies the route correctly handles December → next year January wraparound
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ period: "2026-12" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    // The route should build range [2026-12-01, 2027-01-01) without error
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/budgets (upsert)
// ---------------------------------------------------------------------------

describe("POST /api/budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    class_id: UUID_CLASS_1,
    period: "2026-05",
    amount_cents: 50000,
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

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makePostMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when body is not JSON", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    // Simulate json() throwing (non-parseable body)
    const req = {
      nextUrl: { searchParams: new URLSearchParams() },
      json: async () => { throw new SyntaxError("Unexpected token"); },
    };
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when class_id is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const { class_id: _omit, ...bodyWithoutClassId } = validBody;
    void _omit;
    const req = makePostRequest(bodyWithoutClassId);
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when class_id is not a valid UUID", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, class_id: "not-a-uuid" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when period is malformed (single-digit month)", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, period: "2026-5" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when period is completely invalid", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, period: "abc" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when amount_cents is negative", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: -1 });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when amount_cents is a float", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: 50.5 });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains extra field (strict)", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, household_id: UUID_HH });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 CLASS_NOT_FOUND when class lookup returns 0 rows (not found or RLS-hidden)", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      classResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("CLASS_NOT_FOUND");
  });

  it("should return 500 INSERT_ERROR when class lookup fails with DB error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      classError: { code: "PGRST301", message: "timeout" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INSERT_ERROR");
  });

  it("should return 500 INSERT_ERROR when upsert fails with DB error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      upsertError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INSERT_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 500 INSERT_ERROR when upsert returns no rows", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      upsertResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INSERT_ERROR");
  });

  it("should return 201 with BudgetRow shape on happy path (create)", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      upsertResult: { data: [BUDGET_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest(validBody);
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_BUDGET_1);
    expect(body.household_id).toBe(UUID_HH);
    expect(body.class_id).toBe(UUID_CLASS_1);
    expect(body.period).toBe("2026-05-01"); // normalised to YYYY-MM-01
    expect(body.amount_cents).toBe(50000);
    expect(body).toHaveProperty("created_at");
    expect(body).toHaveProperty("updated_at");
  });

  it("should return 201 on upsert (same class+period, updated amount)", async () => {
    // OQ-1 decision: always 201 regardless of INSERT vs UPDATE
    const updatedRow = { ...BUDGET_ROW, amount_cents: 75000 };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      upsertResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: 75000 });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.amount_cents).toBe(75000);
  });

  it("should return 201 with amount_cents = 0 (zero budget is valid)", async () => {
    const zeroRow = { ...BUDGET_ROW, amount_cents: 0 };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      upsertResult: { data: [zeroRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ ...validBody, amount_cents: 0 });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.amount_cents).toBe(0);
  });
});
