/**
 * Unit tests per PUT /api/classes/:id e DELETE /api/classes/:id
 * (src/app/api/classes/[id]/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
 *
 * Soft delete — comportamento idempotente:
 * Il handler usa una strategia a due step:
 *   1. UPDATE ... WHERE id=? AND archived_at IS NULL → se 0 righe, va al probe.
 *   2. SELECT id WHERE id=? → se esiste → 204 (già archiviata), altrimenti → 404.
 * Il mock rispecchia questo dual-query pattern.
 *
 * PUT reparent — il handler esegue due from() in sequenza:
 *   1. from("categories").select(...).eq(...).limit(1) — verifica categoria target
 *   2. from("classes").update(...).eq(...).select(...) — applica update
 * Il mock usa fromCallCount per distinguere i due scenari.
 *
 * TODO(rls-isolation-test): verificare RLS user-A non-vede-user-B quando
 * supabase locale sarà bootstrappato (MEDIUM debt — ADR-0006 followup).
 * Pattern di riferimento: tests/amex/ e il commento equivalente in
 * src/app/api/funds/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server prima di importare la route
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

// Mock next/server — copre sia NextResponse.json che new NextResponse(null, {status:204})
vi.mock("next/server", () => {
  const MockNextResponse = function (
    body: BodyInit | null,
    init?: { status?: number },
  ) {
    return {
      _body: body,
      status: init?.status ?? 200,
      json: async () => (body ? JSON.parse(body as string) : null),
    };
  };

  MockNextResponse.json = (body: unknown, init?: { status?: number }) => ({
    _body: body,
    status: init?.status ?? 200,
    json: async () => body,
  });

  return { NextResponse: MockNextResponse, NextRequest: vi.fn() };
});

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { PUT, DELETE } from "./route";

// ---------------------------------------------------------------------------
// UUID v4 validi per fixtures (RFC 4122 — terzo gruppo [1-8])
// ---------------------------------------------------------------------------

const UUID_USER      = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH        = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_FUND      = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_CAT_1     = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_CAT_2     = "7b1e2f3a-4c5d-4e6f-a7b8-c9d0e1f2a3b4";
const UUID_CAT_OTHER = "a1b2c3d4-e5f6-4a7b-a8c9-d0e1f2a3b4c5";
const UUID_CLASS_1   = "b2c3d4e5-f6a7-4b8c-a9d0-e1f2a3b4c5d6";
const UUID_CLASS_NF  = "c3d4e5f6-a7b8-4c9d-aabc-f1e2d3c4b5a6";
const NOW            = "2026-05-05T12:00:00.000Z";

// Suppress unused-variable warnings
void UUID_FUND;

// ---------------------------------------------------------------------------
// ClassRow fixture valido (passa ClassRowSchema)
// ---------------------------------------------------------------------------

const CLASS_ROW_ACTIVE = {
  id: UUID_CLASS_1,
  household_id: UUID_HH,
  category_id: UUID_CAT_1,
  name: "Affitto",
  tipologia: "addebito_immediato",
  sort_order: 0,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
};

// ---------------------------------------------------------------------------
// Helper: params promise (Next.js 16 style — params è una Promise)
// ---------------------------------------------------------------------------

function makeParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

// ---------------------------------------------------------------------------
// Helper: NextRequest mock per PUT (con body JSON)
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
// Helper types
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

// ---------------------------------------------------------------------------
// Helper: mock Supabase client per PUT — senza reparenting (singolo from())
// PUT chain: .from("classes").update(updates).eq("id", id).select(...)
// ---------------------------------------------------------------------------

function makePutMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  updateResult?: QueryResult<unknown[]>;
  updateError?: { code: string; message: string };
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [CLASS_ROW_ACTIVE], error: null };

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
// Helper: mock Supabase client per PUT con reparenting (due from() in sequenza)
// 1. from("categories").select(...).eq(...).limit(1) — verifica target category
// 2. from("classes").update(...).eq(...).select(...) — applica update
// ---------------------------------------------------------------------------

function makePutReparentMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  // Prima chiamata (categories lookup)
  categoryResult?: QueryResult<{ household_id: string }[]>;
  categoryError?: { code: string; message: string };
  // Seconda chiamata (classes update)
  updateResult?: QueryResult<unknown[]>;
  updateError?: { code: string; message: string };
}) {
  const defaultCategoryOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultUpdateOk: QueryResult<unknown[]> = {
    data: [CLASS_ROW_ACTIVE],
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
        // Prima chiamata: from("categories").select(...).eq(...).limit(1)
        if (opts.categoryError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.categoryError }),
          };
        }
        const catRes = opts.categoryResult ?? defaultCategoryOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(catRes),
        };
      }

      // Seconda chiamata: from("classes").update(...).eq(...).select(...)
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
// Helper: mock Supabase client per DELETE
// Due scenari di from() in sequenza:
//   1. UPDATE ... IS NULL → se 0 righe, segue probe
//   2. SELECT id WHERE id=? LIMIT 1 (probe)
// ---------------------------------------------------------------------------

function makeDeleteMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  // Prima chiamata: update con is("archived_at", null)
  archiveResult?: QueryResult<{ id: string }[]>;
  archiveError?: { code: string; message: string };
  // Seconda chiamata (probe): select().eq().limit()
  probeResult?: QueryResult<{ id: string }[]>;
  probeError?: { code: string; message: string };
}) {
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
        // Prima chiamata: .update().eq().is().select()
        if (opts.archiveError) {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: null, error: opts.archiveError }),
          };
        }
        const archiveRes = opts.archiveResult ?? { data: [{ id: UUID_CLASS_1 }], error: null };
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue(archiveRes),
        };
      }

      // Seconda chiamata (probe): .select().eq().limit()
      if (opts.probeError) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: null, error: opts.probeError }),
        };
      }
      const probeRes = opts.probeResult ?? { data: [], error: null };
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(probeRes),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: PUT /api/classes/:id
// ---------------------------------------------------------------------------

describe("PUT /api/classes/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePutMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

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

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when :id param is not a valid UUID", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams("not-a-uuid") });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body is empty (no fields provided)", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({}); // zod refine: at least one field required
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is empty string", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is whitespace-only", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "   " });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when tipologia is invalid", async () => {
    const mockClient = makePutMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ tipologia: "risparmio_programmato" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 NOT_FOUND when update affects 0 rows (row not found or RLS hides it)", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [], error: null }, // 0 righe aggiornate
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 200 with updated ClassRow on happy path — rename", async () => {
    const updatedRow = { ...CLASS_ROW_ACTIVE, name: "Mutuo" };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(UUID_CLASS_1);
    expect(body.name).toBe("Mutuo");
    expect(body.category_id).toBe(UUID_CAT_1);
  });

  it("should return 200 when reparenting to another category in same household", async () => {
    // Happy path reparent: categories lookup returns 1 row → update succeeds.
    const reparentedRow = { ...CLASS_ROW_ACTIVE, category_id: UUID_CAT_2 };
    const mockClient = makePutReparentMockSupabase({
      user: { id: UUID_USER },
      categoryResult: { data: [{ household_id: UUID_HH }], error: null },
      updateResult: { data: [reparentedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ category_id: UUID_CAT_2 });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.category_id).toBe(UUID_CAT_2);
    expect(body.id).toBe(UUID_CLASS_1);
  });

  it("should return 404 CATEGORY_NOT_FOUND when reparenting to category in another household", async () => {
    // CONTRACT NIT FROM LEAD: code must be "CATEGORY_NOT_FOUND" not generic "NOT_FOUND".
    // First .from() call (categories lookup) returns { data: [], error: null }.
    const mockClient = makePutReparentMockSupabase({
      user: { id: UUID_USER },
      categoryResult: { data: [], error: null }, // RLS hides the cross-household category
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ category_id: UUID_CAT_OTHER });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("should return 200 when updating tipologia only", async () => {
    const updatedRow = { ...CLASS_ROW_ACTIVE, tipologia: "fondo_lungo" };
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateResult: { data: [updatedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ tipologia: "fondo_lungo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tipologia).toBe("fondo_lungo");
    expect(body.id).toBe(UUID_CLASS_1);
  });

  it("should return 409 CONFLICT when rename causes duplicate (category_id, name) — PG 23505", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Affitto" }); // nome già esistente nella categoria
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFLICT");
  });

  it("should return 500 DB_ERROR on other Supabase update error", async () => {
    const mockClient = makePutMockSupabase({
      user: { id: UUID_USER },
      updateError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePutRequest({ name: "Mutuo" });
    const response = await PUT(req as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/classes/:id — soft delete
// ---------------------------------------------------------------------------

describe("DELETE /api/classes/:id — soft delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeDeleteMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

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

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

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

  it("should return 204 with no body when soft delete succeeds — assert .update() called with archived_at, NOT .delete()", async () => {
    // archiveResult con data: [{id}] → step 1 trova la riga → 204 diretto
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveResult: { data: [{ id: UUID_CLASS_1 }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(204);
    // 204 non ha body — json() ritorna null
    expect(await response.json()).toBeNull();
    // Verifica che .update() sia stato usato (soft delete), NON .delete()
    const fromResult = (mockClient.from as Mock).mock.results[0]?.value as Record<string, Mock>;
    expect(fromResult?.update).toHaveBeenCalled();
    expect(fromResult?.update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) }),
    );
    expect(fromResult).not.toHaveProperty("delete");
  });

  it("should return 204 idempotently when row is already archived (probe finds it)", async () => {
    // Step 1 (UPDATE IS NULL): 0 righe (row già archiviata).
    // Step 2 (probe SELECT): trova la riga → 204.
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveResult: { data: [], error: null }, // UPDATE trova 0 righe
      probeResult: { data: [{ id: UUID_CLASS_1 }], error: null }, // probe trova la riga (già archiviata)
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(204);
    // 204 non ha body — json() ritorna null
    expect(await response.json()).toBeNull();
  });

  it("should return 404 NOT_FOUND when row does not exist or belongs to another household", async () => {
    // Step 1: UPDATE trova 0 righe. Step 2: probe non trova la riga → 404.
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveResult: { data: [], error: null },
      probeResult: { data: [], error: null }, // riga non esiste
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_NF) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should return 500 DB_ERROR when the archive UPDATE fails", async () => {
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 500 DB_ERROR when the existence probe SELECT fails", async () => {
    // Step 1 ritorna 0 righe (triggera il probe). Step 2 (probe) fallisce.
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveResult: { data: [], error: null },
      probeError: { code: "PGRST301", message: "timeout" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should never call .delete() — spy confirms soft delete only", async () => {
    // Verifica esplicita che nessuna from() chain abbia esposto .delete()
    // Il soft delete usa esclusivamente .update() con archived_at.
    const mockClient = makeDeleteMockSupabase({
      user: { id: UUID_USER },
      archiveResult: { data: [{ id: UUID_CLASS_1 }], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    await DELETE({} as never, { params: makeParams(UUID_CLASS_1) });

    // Tutte le from() calls devono avere .update() ma mai .delete()
    const allResults = (mockClient.from as Mock).mock.results;
    for (const result of allResults) {
      const chain = result.value as Record<string, unknown>;
      expect(chain).not.toHaveProperty("delete");
    }
  });
});
