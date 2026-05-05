/**
 * Unit tests per GET /api/accounts e POST /api/accounts
 * (src/app/api/accounts/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
 *
 * GET chain:  .from("accounts").select(...).order(...).order(...).is("archived_at", null) → Promise
 * POST chain (household_members lookup): .from("household_members").select(...).eq(...).limit(1) → Promise
 * POST chain (accounts insert):          .from("accounts").insert(...).select(...) → Promise
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server prima di importare la route
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

const UUID_USER = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH   = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_ACC  = "60d346be-2169-4d73-a562-d4490252bd6f";
const NOW       = "2026-05-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Account row fixture
// ---------------------------------------------------------------------------

const ACCOUNT_ROW = {
  id: UUID_ACC,
  household_id: UUID_HH,
  name: "Conto Principale",
  kind: "corrente",
  currency: "EUR",
  scope: "family",
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
};

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

// ---------------------------------------------------------------------------
// Helper: NextRequest mock con searchParams
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
// Helper: NextRequest mock per POST
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
// GET chain: .from("accounts").select(...).order(...).order(...)[.is()] → resolves
// ---------------------------------------------------------------------------

function makeGetMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  queryResult?: QueryResult<unknown[]>;
  queryError?: { code: string; message: string };
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [ACCOUNT_ROW], error: null };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn(() => {
      const result = opts.queryError
        ? { data: null, error: opts.queryError }
        : (opts.queryResult ?? defaultOk);

      // Route chain:
      //   include_archived=false: select → order → is → await
      //   include_archived=true:  select → order → await
      //
      // The terminal node must be both thenable (awaitable) AND expose .is()
      // so that either code path resolves correctly.
      const terminal = {
        is: vi.fn().mockResolvedValue(result),
        then: (
          resolve: (v: QueryResult<unknown[]>) => void,
          reject: (e: unknown) => void,
        ) => Promise.resolve(result).then(resolve, reject),
      };

      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn(() => terminal),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper: mock Supabase per POST (due from() in sequenza)
// 1. from("household_members").select(...).eq(...).limit(1)
// 2. from("accounts").insert(...).select(...)
// ---------------------------------------------------------------------------

function makePostMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  memberResult?: QueryResult<{ household_id: string }[]>;
  memberError?: { code: string; message: string };
  insertResult?: QueryResult<unknown[]>;
  insertError?: { code: string; message: string };
}) {
  const defaultMemberOk: QueryResult<{ household_id: string }[]> = {
    data: [{ household_id: UUID_HH }],
    error: null,
  };
  const defaultInsertOk: QueryResult<unknown[]> = {
    data: [ACCOUNT_ROW],
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
        // Prima chiamata: household_members lookup
        if (opts.memberError) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: opts.memberError }),
          };
        }
        const res = opts.memberResult ?? defaultMemberOk;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(res),
        };
      }

      // Seconda chiamata: accounts insert
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
// Tests: GET /api/accounts
// ---------------------------------------------------------------------------

describe("GET /api/accounts", () => {
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
    expect(body.error).toBe("Unauthorized");
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

  it("should return 200 with accounts array on happy path", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [ACCOUNT_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_ACC);
    expect(body[0].name).toBe("Conto Principale");
    expect(body[0].kind).toBe("corrente");
  });

  it("should return 200 with empty array when no accounts exist", async () => {
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("should drop malformed rows silently (flatMap pattern)", async () => {
    const malformedRow = { id: "not-a-uuid", household_id: UUID_HH, name: "Bad" };
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [malformedRow, ACCOUNT_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest();
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    // Only the valid row survives
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(UUID_ACC);
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

  it("should return 200 with archived accounts when include_archived=true", async () => {
    // The route skips the `.is("archived_at", null)` call when include_archived=true;
    // RLS still scopes to household. The mock returns ACCOUNT_ROW regardless —
    // what we verify is that the route exits 200 and parses the row correctly on
    // the include_archived path (second .order() is the terminal call).
    const archivedRow = { ...ACCOUNT_ROW, archived_at: "2026-04-01T00:00:00.000Z" };
    const mockClient = makeGetMockSupabase({
      user: { id: UUID_USER },
      queryResult: { data: [archivedRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makeGetRequest({ include_archived: "true" });
    const response = await GET(req as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].archived_at).toBe("2026-04-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/accounts
// ---------------------------------------------------------------------------

describe("POST /api/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makePostMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 400 VALIDATION_ERROR when name is missing", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name is empty string", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when name exceeds 200 characters", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "a".repeat(201), kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when kind is invalid", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Test", kind: "risparmio" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body is invalid JSON", async () => {
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const badReq = {
      nextUrl: { searchParams: new URLSearchParams() },
      json: async () => { throw new SyntaxError("bad json"); },
    };
    const response = await POST(badReq as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 400 VALIDATION_ERROR when body contains unknown keys (.strict())", async () => {
    // `bank` is granted at the DB level but must NOT be accepted by the API
    // body schema — strict() ensures unknown keys are rejected, not silently stripped.
    const mockClient = makePostMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "X", kind: "corrente", bank: "haxor" });
    const response = await POST(req as never);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return 409 NO_HOUSEHOLD when household_members returns 0 rows", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      memberResult: { data: [], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("NO_HOUSEHOLD");
  });

  it("should return 409 CONFLICT when name already exists (PG 23505)", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFLICT");
    expect(body.error).toBe("Esiste già un conto con questo nome.");
  });

  it("should return 201 with inserted AccountRow on happy path", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [ACCOUNT_ROW], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(UUID_ACC);
    expect(body.name).toBe("Conto Principale");
    expect(body.kind).toBe("corrente");
    expect(body.currency).toBe("EUR");
    expect(body.scope).toBe("family");
  });

  it("should return 500 DB_ERROR on other insert error", async () => {
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertError: { code: "PGRST301", message: "connection refused" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Principale", kind: "corrente" });
    const response = await POST(req as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    expect(body).not.toHaveProperty("stack");
  });

  it("should accept kind=fondi as a valid account kind", async () => {
    const fondiRow = { ...ACCOUNT_ROW, kind: "fondi" };
    const mockClient = makePostMockSupabase({
      user: { id: UUID_USER },
      insertResult: { data: [fondiRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const req = makePostRequest({ name: "Conto Fondi", kind: "fondi" });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.kind).toBe("fondi");
  });
});
