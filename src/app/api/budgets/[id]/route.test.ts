/**
 * Integration tests for PUT /api/budgets/:id and DELETE /api/budgets/:id
 * (src/app/api/budgets/[id]/route.ts)
 *
 * Strategy: lightweight mock of src/lib/supabase/server.ts to simulate
 * Supabase responses without a real DB.
 *
 * PUT constraints (grants.sql L152):
 *   GRANT UPDATE (amount_cents) only — class_id and period are immutable.
 *   BudgetUpdateInputSchema.strict() rejects extra fields before the DB sees them.
 *
 * PUT chain:
 *   .from("budgets").update({amount_cents}).eq("id", budgetId).select(...) → Promise
 *   0 rows → 404; ≥1 row → 200.
 *
 * DELETE chain (hard delete — no archived_at on budgets):
 *   .from("budgets").delete().eq("id", budgetId).select("id") → Promise
 *   0 rows → 404; ≥1 row → 204 empty body.
 *
 * NOTE: Uses RFC 4122-compliant UUID v4s (Zod v4 applies strict regex on
 * the version nibble [1-8]).
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
import { PUT, DELETE } from "./route";

// ---------------------------------------------------------------------------
// UUID fixtures (RFC 4122 v4)
// ---------------------------------------------------------------------------

const UUID_USER      = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH        = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_CLASS_1   = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_BUDGET_1  = "b2c3d4e5-f6a7-4b8c-a9d0-e1f2a3b4c5d6";
const UUID_BUDGET_NF = "c3d4e5f6-a7b8-4c9d-aabc-f1e2d3c4b5a6"; // not found

const NOW = "2026-05-05T12:00:00.000Z";

// Suppress unused-variable lint warning
void UUID_BUDGET_NF;

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
// Helper: params promise (Next.js 16 — params is a Promise)
// ---------------------------------------------------------------------------

function makeParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

// ---------------------------------------------------------------------------
// Helper: PUT request mock
// ---------------------------------------------------------------------------

function makePutRequest(body: unknown): {
  nextUrl: { searchParams: URLSearchParams };
  json: () => Promise<unknown>;
} {
  return {
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => body,
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase for PUT
// Chain: .from("budgets").update({amount_cents}).eq("id", id).select(...) → Promise
// ---------------------------------------------------------------------------

function makePutMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  updateResult?: QueryResult<unknown[]>;
  updateError?: { code: string; message: string };
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [BUDGET_ROW], error: null };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => {
      const result = opts.updateError
        ? { data: null, error: opts.updateError }
        : (opts.updateResult ?? defaultOk);
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase for DELETE
// Chain: .from("budgets").delete().eq("id", id).select("id") → Promise
// ---------------------------------------------------------------------------

function makeDeleteMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  deleteResult?: QueryResult<{ id: string }[]>;
  deleteError?: { code: string; message: string };
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => {
      const result = opts.deleteError
        ? { data: null, error: opts.deleteError }
        : (opts.deleteResult ?? { data: [{ id: UUID_BUDGET_1 }], error: null });
      return {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: PUT /api/budgets/:id
// ---------------------------------------------------------------------------

describe("PUT /api/budgets/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePutMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makePutMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when :id param is not a valid UUID", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams("not-a-uuid") });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body is empty (no amount_cents)", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({});
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when amount_cents is negative", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: -1 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains class_id (.strict() rejects it)", async () => {
    // class_id is immutable — the DB UNIQUE constraint on (class_id, period) encodes this.
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000, class_id: UUID_CLASS_1 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains period (.strict() rejects it)", async () => {
    // period is immutable after creation
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000, period: "2026-06" });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body is not JSON", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = {
      nextUrl: { searchParams: new URLSearchParams() },
      json: async () => { throw new SyntaxError("Unexpected token"); },
    };
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 NOT_FOUND when update affects 0 rows (RLS hides it or not found)", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 500 UPDATE_ERROR on Supabase update error", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("UPDATE_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 200 with updated BudgetRow on happy path", async () => {
    const updatedRow = { ...BUDGET_ROW, amount_cents: 75000 };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 75000 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(UUID_BUDGET_1);
    expect(body.amount_cents).toBe(75000);
    expect(body.period).toBe("2026-05-01");
    expect(body.class_id).toBe(UUID_CLASS_1);
    expect(body.household_id).toBe(UUID_HH);
  });

  it("should return 200 when setting amount_cents = 0 (zero budget is valid)", async () => {
    const zeroRow = { ...BUDGET_ROW, amount_cents: 0 };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [zeroRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ amount_cents: 0 });
    const response = await PUT(req as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.amount_cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/budgets/:id — hard delete
// ---------------------------------------------------------------------------

describe("DELETE /api/budgets/:id — hard delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeDeleteMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when :id param is not a valid UUID", async () => {
    const mockClient = makeDeleteMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams("not-a-uuid") });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 204 with null body when hard delete succeeds", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [{ id: UUID_BUDGET_1 }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(204);
    expect(await response.json()).toBeNull();
  });

  it("should use .delete() not .update() — confirms hard delete", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [{ id: UUID_BUDGET_1 }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    const allResults = (mockClient.from as Mock).mock.results;
    for (const result of allResults) {
      const chain = result.value as Record<string, unknown>;
      expect(chain).toHaveProperty("delete");
      expect(chain).not.toHaveProperty("update");
    }
  });

  it("should return 404 NOT_FOUND when row does not exist or is RLS-hidden", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [], error: null }, // 0 rows deleted
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 500 DELETE_ERROR when the delete query fails", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_BUDGET_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DELETE_ERROR");
    expect(body).not.toHaveProperty("stack");
  });
});
