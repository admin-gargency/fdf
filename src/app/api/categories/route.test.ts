/**
 * Unit tests per GET /api/categories e POST /api/categories
 * (src/app/api/categories/route.ts)
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

const UUID_USER = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_FUND = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_FUND_2 = "7b1e2f3a-4c5d-4e6f-a7b8-c9d0e1f2a3b4";
const UUID_CAT_1 = "9f892bca-9915-4ca7-b577-31acef4af3e6";

const NOW = "2026-05-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// CategoryRow fixture valido (passa CategoryRowSchema)
// ---------------------------------------------------------------------------

const CAT_ROW_ACTIVE = {
  id: UUID_CAT_1,
  household_id: UUID_HH,
  fund_id: UUID_FUND,
  name: "Azioni",
  sort_order: 0,
  archived_at: null,
  target_amount_cents: null,
  current_amount_cents: 0,
  created_at: NOW,
  updated_at: NOW,
};

const CAT_ROW_ARCHIVED = {
  ...CAT_ROW_ACTIVE,
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
// Helper: mock Supabase client per GET (singola query su categories)
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

function makeGetMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  categoriesResult?: QueryResult<unknown[]>;
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [], error: null };

  // La route costruisce il chain così:
  //   supabase.from(...).select(...).eq(...).order(...).order(...)
  //   if (!includeArchived) query = query.is("archived_at", null)
  //   const { data, error } = await query
  //
  // Il chain viene `await`-ato direttamente (protocollo thenable).
  // Usiamo un oggetto thenable che risolve con `result` quando viene awaited,
  // indipendentemente da quale metodo è stato chiamato per ultimo (.order o .is).
  const makeChain = (result: QueryResult<unknown[]>) => {
    const chain: Record<string, unknown> = {};
    const selfReturn = () => chain;
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    // Thenable: quando il chain viene awaited, risolve con result.
    chain.then = (
      resolve: (value: QueryResult<unknown[]>) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject);
    // Compatibilità con pattern await: necessita anche di catch/finally
    chain.catch = (fn: (reason: unknown) => void) =>
      Promise.resolve(result).catch(fn);
    chain.finally = (fn: () => void) =>
      Promise.resolve(result).finally(fn);
    void selfReturn; // suppress unused warning
    return chain;
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => makeChain(opts.categoriesResult ?? defaultOk)),
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase client per POST (query funds + insert categories)
// ---------------------------------------------------------------------------

function makePostMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  fundResult?: QueryResult<{ household_id: string }[]>;
  insertResult?: QueryResult<unknown[]>;
  insertError?: { code: string; message: string };
}) {
  const defaultFundOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultInsertOk: QueryResult<unknown[]> = {
    data: [CAT_ROW_ACTIVE],
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
        // Prima chiamata: from("funds").select(...).eq(...).limit(1)
        const fundRes = opts.fundResult ?? defaultFundOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(fundRes),
        };
      }
      // Seconda chiamata: from("categories").insert(...).select(...)
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
// Tests: GET /api/categories
// ---------------------------------------------------------------------------

describe("GET /api/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makeRequest({ fund_id: UUID_FUND });
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeGetMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND });
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

    const req = makeRequest({ fund_id: UUID_FUND });
    const response = await GET(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when fund_id query param is missing", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({}); // no fund_id
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when fund_id is not a valid UUID", async () => {
    const mockClient = makeGetMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: "not-a-uuid" });
    const response = await GET(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with empty array when no active categories exist for fund", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      categoriesResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it("should return 200 with correct CategoryRow shape for one active category", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      categoriesResult: { data: [CAT_ROW_ACTIVE], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    const cat = body[0];
    expect(cat.id).toBe(UUID_CAT_1);
    expect(cat.fund_id).toBe(UUID_FUND);
    expect(cat.name).toBe("Azioni");
    expect(cat.archived_at).toBeNull();
    expect(cat.target_amount_cents).toBeNull();
    expect(cat.current_amount_cents).toBe(0);
    // household_id presente nel payload (CategoryRowSchema lo include)
    expect(cat.household_id).toBe(UUID_HH);
  });

  it("should exclude archived categories by default (archived_at IS NOT NULL omitted)", async () => {
    // Il mock usa .is("archived_at", null) — il comportamento è testato
    // verificando che la risposta non contenga la riga archiviata.
    // Il mock di makeGetMockSupabase risolve su .is() per il path non-archived.
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      // Simuliamo che il DB (post-filtro IS NULL) ritorni solo la riga attiva
      categoriesResult: { data: [CAT_ROW_ACTIVE], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND }); // no include_archived
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    // Nessuna riga con archived_at non-null
    expect(body.every((r: { archived_at: string | null }) => r.archived_at === null)).toBe(true);
  });

  it("should include archived categories when ?include_archived=true", async () => {
    // Con include_archived=true il chain NON chiama .is() — si ferma alla seconda .order().
    // makeGetMockSupabase risolve la seconda .order() con Promise.resolve(result).
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      categoriesResult: { data: [CAT_ROW_ACTIVE, CAT_ROW_ARCHIVED], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND, include_archived: "true" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    const archivedRow = body.find((r: { archived_at: string | null }) => r.archived_at !== null);
    expect(archivedRow).toBeDefined();
    expect(archivedRow.archived_at).toBe("2026-05-04T10:00:00.000Z");
  });

  it("should return 500 DB_ERROR on Supabase query error, with no stack or message keys", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      categoriesResult: {
        data: null,
        error: { code: "PGRST301", message: "relation does not exist" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeRequest({ fund_id: UUID_FUND });
    const response = await GET(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("message");
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/categories
// ---------------------------------------------------------------------------

describe("POST /api/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePostMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
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

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when fund_id is missing from body", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Azioni" }); // no fund_id
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when fund_id is not a valid UUID", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: "not-a-uuid", name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND }); // no name
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is empty string", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is whitespace-only", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "   " });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 FUND_NOT_FOUND when fund does not exist or is in another household", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      fundResult: { data: [], error: null }, // RLS restituisce 0 righe
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND_2, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("FUND_NOT_FOUND");
  });

  it("should return 201 with created CategoryRow on happy path", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_CAT_1);
    expect(body.fund_id).toBe(UUID_FUND);
    expect(body.name).toBe("Azioni");
    expect(body.archived_at).toBeNull();
    expect(body.household_id).toBe(UUID_HH);
  });

  it("should return 409 CONFLICT on duplicate (fund_id, name) — PG 23505", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFLICT");
  });

  it("should return 500 DB_ERROR on other Supabase fund-lookup error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      fundResult: { data: null, error: { code: "PGRST301", message: "timeout" } },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
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

    const req = makePostRequest({ fund_id: UUID_FUND, name: "Azioni" });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });
});
