/**
 * Unit tests per PUT /api/transactions/:id e DELETE /api/transactions/:id
 * (src/app/api/transactions/[id]/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
 *
 * DELETE è hard delete (no archived_at su transactions).
 *   Chain: .from("transactions").delete().eq("id", id).select("id") → Promise
 *   0 righe → 404; ≥1 riga → 204.
 *
 * PUT — due scenari per class_id non-null:
 *   1. from("transactions").select("household_id").eq(...).limit(1)  → resolve tx household
 *   2. from("classes").select("household_id").eq(...).limit(1)       → cross-household check
 *   3. from("transactions").update(...).eq(...).select(...)          → apply update
 *
 *   PUT senza class_id o con class_id=null (un-assign):
 *   1. from("transactions").update(...).eq(...).select(...)          → direct update
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

const UUID_USER    = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH      = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_HH_B    = "aabbccdd-1122-4334-a556-778899aabbcc";
const UUID_ACC     = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_CLASS_1 = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_CLASS_B = "a1b2c3d4-e5f6-4a7b-a8c9-d0e1f2a3b4c5"; // another household
const UUID_TX      = "b2c3d4e5-f6a7-4b8c-a9d0-e1f2a3b4c5d6";
const UUID_TX_NF   = "c3d4e5f6-a7b8-4c9d-aabc-f1e2d3c4b5a6"; // not found
const NOW          = "2026-05-05T12:00:00.000Z";

// Suppress unused-variable lint warnings for fixtures not referenced directly.
void UUID_ACC;

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
// Helpers: params promise (Next.js 16 — params is a Promise)
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
// Helper: mock Supabase for PUT — no class_id lookup (single from() chain)
// Chain: .from("transactions").update(...).eq(...).select(...) → Promise
// ---------------------------------------------------------------------------

function makePutMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  updateResult?: QueryResult<unknown[]>;
  updateError?: { code: string; message: string };
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [TX_ROW], error: null };

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
// Helper: mock Supabase for PUT with class_id lookup (three from() calls)
// 1. from("transactions").select("household_id").eq(...).limit(1)
// 2. from("classes").select("household_id").eq(...).limit(1)
// 3. from("transactions").update(...).eq(...).select(...)
// ---------------------------------------------------------------------------

function makePutWithClassMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  txLookupResult?: QueryResult<{ household_id: string }[]>;
  txLookupError?: { code: string; message: string };
  classLookupResult?: QueryResult<{ household_id: string }[]>;
  classLookupError?: { code: string; message: string };
  updateResult?: QueryResult<unknown[]>;
  updateError?: { code: string; message: string };
}) {
  const defaultTxLookup: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultClassLookup: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultUpdateOk: QueryResult<unknown[]> = {
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
        // Transaction household lookup
        if (opts.txLookupError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.txLookupError }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(opts.txLookupResult ?? defaultTxLookup),
        };
      }

      if (fromCallCount === 2) {
        // Class household lookup
        if (opts.classLookupError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.classLookupError }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(opts.classLookupResult ?? defaultClassLookup),
        };
      }

      // Third call: transaction update
      const result = opts.updateError
        ? { data: null, error: opts.updateError }
        : (opts.updateResult ?? defaultUpdateOk);
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
// Chain: .from("transactions").delete().eq("id", id).select("id") → Promise
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
        : (opts.deleteResult ?? { data: [{ id: UUID_TX }], error: null });
      return {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: PUT /api/transactions/:id
// ---------------------------------------------------------------------------

describe("PUT /api/transactions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePutMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makePutMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when :id param is not a valid UUID", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams("not-a-uuid") });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body is empty (no fields)", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({});
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when class_id is not a UUID (non-null string)", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: "bad-uuid" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when description exceeds 200 chars", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "x".repeat(201) });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains unknown keys (.strict())", async () => {
    // `source` is a column in the DB but must NEVER be mutable by the client.
    // strict() ensures it is rejected rather than silently stripped.
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: UUID_CLASS_1, source: "psd2" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

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

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 200 with updated TransactionRow on happy path — description only", async () => {
    const updatedRow = { ...TX_ROW, description: "Aggiornata" };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "Aggiornata" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(UUID_TX);
    expect(body.description).toBe("Aggiornata");
  });

  it("should return 200 when setting needs_review=false", async () => {
    const updatedRow = { ...TX_ROW, needs_review: false };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ needs_review: false });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needs_review).toBe(false);
  });

  it("should accept class_id=null (un-assign from class) — goes straight to update", async () => {
    const unassignedRow = { ...TX_ROW, class_id: null };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [unassignedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: null });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.class_id).toBeNull();
  });

  it("should return 200 when reassigning class_id to another class in same household", async () => {
    const reclassifiedRow = { ...TX_ROW, class_id: UUID_CLASS_1 };
    const mockClient = makePutWithClassMockSupabase({
      user: { id: UUID_USER },
      txLookupResult: { data: [{ household_id: UUID_HH }], error: null },
      classLookupResult: { data: [{ household_id: UUID_HH }], error: null },
      updateResult: { data: [reclassifiedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: UUID_CLASS_1 });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.class_id).toBe(UUID_CLASS_1);
  });

  it("should return 403 CROSS_HOUSEHOLD when class_id belongs to another household", async () => {
    const mockClient = makePutWithClassMockSupabase({
      user: { id: UUID_USER },
      txLookupResult: { data: [{ household_id: UUID_HH }], error: null },
      classLookupResult: { data: [{ household_id: UUID_HH_B }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: UUID_CLASS_B });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("CROSS_HOUSEHOLD");
  });

  it("should return 403 CROSS_HOUSEHOLD when class_id is hidden by RLS (not found)", async () => {
    const mockClient = makePutWithClassMockSupabase({
      user: { id: UUID_USER },
      txLookupResult: { data: [{ household_id: UUID_HH }], error: null },
      classLookupResult: { data: [], error: null }, // RLS hides it
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ class_id: UUID_CLASS_B });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("CROSS_HOUSEHOLD");
  });

  it("should return 500 DB_ERROR on update error", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ description: "Test" });
    const response = await PUT(req as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/transactions/:id — hard delete
// ---------------------------------------------------------------------------

describe("DELETE /api/transactions/:id — hard delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const response = await DELETE({} as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeDeleteMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_TX) });

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

    const response = await DELETE({} as never, { params: makeParams(UUID_TX) });

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

  it("should return 204 with no body when hard delete succeeds", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [{ id: UUID_TX }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(204);
    expect(await response.json()).toBeNull();

    // Verify .delete() was called (hard delete) — NOT .update()
    const fromResult = (mockClient.from as Mock).mock.results[0]?.value as Record<string, Mock>;
    expect(fromResult?.delete).toHaveBeenCalled();
    expect(fromResult).not.toHaveProperty("update");
  });

  it("should return 404 NOT_FOUND when row does not exist or belongs to another household", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [], error: null }, // 0 rows deleted (cross-household or not found)
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_TX_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 500 DB_ERROR when the delete query fails", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_TX) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should use .delete() not .update() — hard delete confirmed by spy", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      deleteResult: { data: [{ id: UUID_TX }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    await DELETE({} as never, { params: makeParams(UUID_TX) });

    const allResults = (mockClient.from as Mock).mock.results;
    for (const result of allResults) {
      const chain = result.value as Record<string, unknown>;
      expect(chain).toHaveProperty("delete");
      expect(chain).not.toHaveProperty("update");
    }
  });
});
