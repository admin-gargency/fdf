/**
 * Integration tests per GET /api/funds (src/app/api/funds/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
 *
 * TODO(rls-isolation-test): verificare RLS user-A non-vede-user-B quando
 * supabase locale sarà bootstrappato (MEDIUM debt — ADR-0006 followup).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server prima di importare la route
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

// Mock next/server per NextResponse.json
vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: (body: unknown, init?: { status?: number }) => ({
        _body: body,
        status: init?.status ?? 200,
        json: async () => body,
      }),
    },
  };
});

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// UUID v4 validi per fixtures
// ---------------------------------------------------------------------------

const UUID_USER  = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH    = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_FUND  = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_CAT   = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_CLASS = "c0ef16ec-e0a0-423b-85bc-f4f87a176ef7";

const NOW = "2026-05-04T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Helper: crea un mock Supabase client configurabile per test
// ---------------------------------------------------------------------------

type QueryResult<T> = { data: T | null; error: null | { code: string; message: string } };

interface MockQueryChain<T> {
  data: T | null;
  error: QueryResult<T>["error"];
}

function makeMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  fundsResult?: MockQueryChain<unknown[]>;
  categoriesResult?: MockQueryChain<unknown[]>;
  classesResult?: MockQueryChain<unknown[]>;
}) {
  const defaultOk = { data: [], error: null };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn((table: string) => {
      const result =
        table === "funds"
          ? (opts.fundsResult ?? defaultOk)
          : table === "categories"
            ? (opts.categoriesResult ?? defaultOk)
            : (opts.classesResult ?? defaultOk);

      return {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue(result),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/funds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 500 quando getServerSupabaseClient ritorna null (env mancanti)", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("ritorna 401 quando auth.getUser() ritorna user null", async () => {
    const mockClient = makeMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.error).toBe("Unauthorized");
  });

  it("ritorna 401 quando auth.getUser() ritorna un errore", async () => {
    const mockClient = makeMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("ritorna 200 con array vuoto quando non ci sono fund attivi", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it("ritorna 200 con shape corretta per 1 fondo, 1 categoria, 1 classe", async () => {
    const fundRow = {
      id: UUID_FUND,
      household_id: UUID_HH,
      default_account_id: null,
      name: "Casa",
      sort_order: 0,
      archived_at: null,
      target_amount_cents: 500_000,
      current_amount_cents: 120_000,
      created_at: NOW,
      updated_at: NOW,
    };
    const categoryRow = {
      id: UUID_CAT,
      household_id: UUID_HH,
      fund_id: UUID_FUND,
      name: "Mutuo",
      sort_order: 0,
      archived_at: null,
      target_amount_cents: null,
      current_amount_cents: 80_000,
      created_at: NOW,
      updated_at: NOW,
    };
    const classRow = {
      id: UUID_CLASS,
      household_id: UUID_HH,
      category_id: UUID_CAT,
      name: "Rata mensile",
      tipologia: "addebito_immediato",
      sort_order: 0,
      archived_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: [fundRow], error: null },
      categoriesResult: { data: [categoryRow], error: null },
      classesResult: { data: [classRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Casa");
    expect(body[0].target_amount_cents).toBe(500_000);
    expect(body[0].current_amount_cents).toBe(120_000);
    expect(body[0].categories).toHaveLength(1);

    const cat = body[0].categories[0];
    expect(cat.name).toBe("Mutuo");
    expect(cat.target_amount_cents).toBeNull();
    expect(cat.current_amount_cents).toBe(80_000);
    // default_account_id NON deve essere presente sul nodo categoria
    expect(cat).not.toHaveProperty("default_account_id");
    expect(cat.classes).toHaveLength(1);

    const cls = cat.classes[0];
    expect(cls.tipologia).toBe("addebito_immediato");
    // ClassNode non ha campi importo
    expect(cls).not.toHaveProperty("target_amount_cents");
    expect(cls).not.toHaveProperty("current_amount_cents");
  });

  it("ritorna 500 su errore DB query funds", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: null, error: { code: "PGRST301", message: "relation does not exist" } },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
    // Verifica assenza di stack trace nella risposta
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("message");
  });

  it("ritorna 500 su errore DB query categories", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: {
        data: [{
          id: UUID_FUND,
          household_id: UUID_HH,
          default_account_id: null,
          name: "Casa",
          sort_order: 0,
          archived_at: null,
          target_amount_cents: null,
          current_amount_cents: 0,
          created_at: NOW,
          updated_at: NOW,
        }],
        error: null,
      },
      categoriesResult: { data: null, error: { code: "PGRST301", message: "timeout" } },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("DB_ERROR");
  });
});
