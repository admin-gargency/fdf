/**
 * Unit tests per GET /api/classes e POST /api/classes
 * (src/app/api/classes/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
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

// Mock next/server — copre sia NextResponse.json che new NextResponse(null, {status})
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
import { GET, POST } from "./route";

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

// Suppress unused-variable warnings for fixtures not used in route.test.ts
void UUID_FUND;
void UUID_CAT_2;
void UUID_CAT_OTHER;
void UUID_CLASS_NF;

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

const CLASS_ROW_ARCHIVED = {
  ...CLASS_ROW_ACTIVE,
  archived_at: "2026-05-04T10:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Helper: NextRequest mock con searchParams
// ---------------------------------------------------------------------------

function makeRequest(searchParams: Record<string, string> = {}): {
  nextUrl: { searchParams: URLSearchParams };
  json: () => Promise<unknown>;
} {
  const sp = new URLSearchParams(searchParams);
  return {
    nextUrl: { searchParams: sp },
    json: async () => ({}),
  };
}

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
// Helper types
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

// ---------------------------------------------------------------------------
// Helper: mock Supabase client per GET (singola query su classes)
// ---------------------------------------------------------------------------

function makeGetMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  classesResult?: QueryResult<unknown[]>;
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [], error: null };

  // La route costruisce il chain così:
  //   supabase.from(...).select(...).eq(...).order(...).order(...)
  //   if (!includeArchived) query = query.is("archived_at", null)
  //   const { data, error } = await query
  //
  // Il chain viene `await`-ato direttamente (protocollo thenable).
  const makeChain = (result: QueryResult<unknown[]>) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    // Thenable: quando il chain viene awaited, risolve con result.
    chain.then = (
      resolve: (value: QueryResult<unknown[]>) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject);
    chain.catch = (fn: (reason: unknown) => void) =>
      Promise.resolve(result).catch(fn);
    chain.finally = (fn: () => void) =>
      Promise.resolve(result).finally(fn);
    return chain;
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => makeChain(opts.classesResult ?? defaultOk)),
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase client per POST (query categories + insert classes)
// ---------------------------------------------------------------------------

function makePostMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  categoryResult?: QueryResult<{ household_id: string }[]>;
  insertResult?: QueryResult<unknown[]>;
  insertError?: { code: string; message: string };
}) {
  const defaultCategoryOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultInsertOk: QueryResult<unknown[]> = {
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
        const categoryRes = opts.categoryResult ?? defaultCategoryOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(categoryRes),
        };
      }
      // Seconda chiamata: from("classes").insert(...).select(...)
      const insertRes = opts.insertError
        ? { data: null, error: opts.insertError }
        : (opts.insertResult ?? defaultInsertOk);
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(insertRes),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: GET /api/classes
// ---------------------------------------------------------------------------

describe("GET /api/classes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeGetMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns an error", async () => {
    const mockClient = makeGetMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when category_id query param is missing", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({}); // no category_id
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when category_id is not a valid UUID", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: "not-a-uuid" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with empty array when no active classes exist for category", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      classesResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it("should return 200 with correct ClassRow shape for one active class", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      classesResult: { data: [CLASS_ROW_ACTIVE], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    const cls = body[0];
    expect(cls.id).toBe(UUID_CLASS_1);
    expect(cls.category_id).toBe(UUID_CAT_1);
    expect(cls.name).toBe("Affitto");
    expect(cls.tipologia).toBe("addebito_immediato");
    expect(cls.archived_at).toBeNull();
    expect(cls.household_id).toBe(UUID_HH);
    // ClassRowSchema does NOT include amount fields
    expect(cls).not.toHaveProperty("target_amount_cents");
    expect(cls).not.toHaveProperty("current_amount_cents");
  });

  it("should exclude archived classes by default — verify .is() filter applied", async () => {
    // Il mock simula che il DB (post-filtro IS NULL) ritorni solo la riga attiva.
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      classesResult: { data: [CLASS_ROW_ACTIVE], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 }); // no include_archived
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    // Nessuna riga con archived_at non-null
    expect(
      body.every((r: { archived_at: string | null }) => r.archived_at === null),
    ).toBe(true);
    // Verifica che il chain .is() sia stato chiamato (archivio escluso per default)
    const fromResult = (mockClient.from as Mock).mock.results[0]?.value as Record<string, Mock>;
    expect(fromResult?.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("should include archived classes when ?include_archived=true — verify .is() NOT called", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      classesResult: { data: [CLASS_ROW_ACTIVE, CLASS_ROW_ARCHIVED], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1, include_archived: "true" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    const archivedRow = body.find(
      (r: { archived_at: string | null }) => r.archived_at !== null,
    );
    expect(archivedRow).toBeDefined();
    expect(archivedRow.archived_at).toBe("2026-05-04T10:00:00.000Z");
    // Con include_archived=true il chain NON chiama .is()
    const fromResult = (mockClient.from as Mock).mock.results[0]?.value as Record<string, Mock>;
    expect(fromResult?.is).not.toHaveBeenCalled();
  });

  it("should return 500 DB_ERROR on Supabase query error, with no stack or message keys", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      classesResult: {
        data: null,
        error: { code: "PGRST301", message: "relation does not exist" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ category_id: UUID_CAT_1 });
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("message");
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/classes
// ---------------------------------------------------------------------------

describe("POST /api/classes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePostMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
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

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when category_id is missing from body", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Affitto", tipologia: "addebito_immediato" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when category_id is not a valid UUID", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: "not-a-uuid",
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ category_id: UUID_CAT_1, tipologia: "addebito_immediato" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is empty string", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is whitespace-only", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "   ",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when tipologia is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ category_id: UUID_CAT_1, name: "Affitto" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when tipologia is invalid (risparmio_programmato not in enum)", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "risparmio_programmato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 CATEGORY_NOT_FOUND when category does not exist or is in another household", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      categoryResult: { data: [], error: null }, // RLS restituisce 0 righe
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_OTHER,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("should return 201 with created ClassRow on happy path — tipologia addebito_immediato", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_CLASS_1);
    expect(body.category_id).toBe(UUID_CAT_1);
    expect(body.name).toBe("Affitto");
    expect(body.tipologia).toBe("addebito_immediato");
    expect(body.archived_at).toBeNull();
    expect(body.household_id).toBe(UUID_HH);
  });

  it("should return 201 with created ClassRow on happy path — tipologia fondo_breve", async () => {
    const fondo_breve_row = {
      ...CLASS_ROW_ACTIVE,
      name: "Vacanze",
      tipologia: "fondo_breve",
    };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [fondo_breve_row], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Vacanze",
      tipologia: "fondo_breve",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tipologia).toBe("fondo_breve");
    expect(body.name).toBe("Vacanze");
  });

  it("should return 201 with created ClassRow on happy path — tipologia fondo_lungo", async () => {
    const fondo_lungo_row = {
      ...CLASS_ROW_ACTIVE,
      name: "Mutuo",
      tipologia: "fondo_lungo",
    };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [fondo_lungo_row], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Mutuo",
      tipologia: "fondo_lungo",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tipologia).toBe("fondo_lungo");
    expect(body.name).toBe("Mutuo");
  });

  it("should return 409 CONFLICT on duplicate (category_id, name) — PG 23505", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFLICT");
  });

  it("should return 500 DB_ERROR on other Supabase category-lookup error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      categoryResult: {
        data: null,
        error: { code: "PGRST301", message: "timeout" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 500 DB_ERROR on other Supabase insert error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({
      category_id: UUID_CAT_1,
      name: "Affitto",
      tipologia: "addebito_immediato",
    });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });
});
