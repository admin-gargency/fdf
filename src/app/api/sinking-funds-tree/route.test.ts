/**
 * Integration tests per GET /api/sinking-funds-tree
 * (src/app/api/sinking-funds-tree/route.ts)
 *
 * Strategia: mock leggero di src/lib/supabase/server.ts per simulare
 * risposte Supabase senza accesso reale al DB.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo.
 *
 * NOTE(rls-isolation-test): I test di isolamento RLS (utente A non vede
 * i dati di utente B) NON sono inclusi qui — richiedono un DB reale
 * (Supabase locale via Docker) e sono coperti dall'audit del
 * security-reviewer prima del merge (AGENTS.md §Coverage strategy).
 * Non scrivere fake "RLS test" con mock: non provano nulla sull'isolamento.
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

const UUID_USER    = "e82779b0-1a56-4c8a-a4e9-c0a53dd1b39c";
const UUID_HH      = "23568308-ad35-4069-a8a4-213b2098aec1";
const UUID_FUND    = "60d346be-2169-4d73-a562-d4490252bd6f";
const UUID_CAT     = "9f892bca-9915-4ca7-b577-31acef4af3e6";
const UUID_CLASS_1 = "c0ef16ec-e0a0-423b-85bc-f4f87a176ef7";
const UUID_CLASS_2_VALID = "d1f027fd-f1b1-434c-96cd-050928185678";
const UUID_SF_1    = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const UUID_ACCOUNT = "0efb96b3-ce86-432b-b0d9-fbe68dea7a46";

const NOW = "2026-05-04T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Helper: crea un mock Supabase client configurabile per test
// La route usa Promise.all su 4 tabelle: funds, categories, classes, sinking_funds.
// Ogni tabella ha una catena di metodi query differente:
//   funds/categories/classes: .select().is().order()
//   sinking_funds: .select() (nessun .is/.order nel codice della route)
// ---------------------------------------------------------------------------

type QueryResult<T> = {
  data: T | null;
  error: null | { code: string; message: string };
};

function makeMockSupabase(opts: {
  user: { id: string } | null;
  authError?: unknown;
  fundsResult?: QueryResult<unknown[]>;
  categoriesResult?: QueryResult<unknown[]>;
  classesResult?: QueryResult<unknown[]>;
  sinkingFundsResult?: QueryResult<unknown[]>;
}) {
  const defaultOk: QueryResult<unknown[]> = { data: [], error: null };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.authError ?? null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "funds") {
        const result = opts.fundsResult ?? defaultOk;
        return {
          select: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue(result),
        };
      }
      if (table === "categories") {
        const result = opts.categoriesResult ?? defaultOk;
        return {
          select: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue(result),
        };
      }
      if (table === "classes") {
        const result = opts.classesResult ?? defaultOk;
        return {
          select: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue(result),
        };
      }
      if (table === "sinking_funds") {
        // sinking_funds query: .select(...) — no .is() or .order() in the route
        const result = opts.sinkingFundsResult ?? defaultOk;
        return {
          select: vi.fn().mockResolvedValue(result),
        };
      }
      // Fallback for any unexpected table
      return {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue(defaultOk),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared row fixtures
// ---------------------------------------------------------------------------

const fundRow = {
  id: UUID_FUND,
  household_id: UUID_HH,
  default_account_id: UUID_ACCOUNT,
  name: "Fondo Risparmio",
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
  name: "Accantonamento Casa",
  sort_order: 0,
  archived_at: null,
  target_amount_cents: 400_000,
  current_amount_cents: 100_000,
  created_at: NOW,
  updated_at: NOW,
};

const classRowFondoBreve = {
  id: UUID_CLASS_1,
  household_id: UUID_HH,
  category_id: UUID_CAT,
  name: "Caparra",
  tipologia: "fondo_breve",
  sort_order: 0,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const classRowAddebitoImm = {
  id: UUID_CLASS_2_VALID,
  household_id: UUID_HH,
  category_id: UUID_CAT,
  name: "Spese notaio",
  tipologia: "addebito_immediato",
  sort_order: 1,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const sinkingFundRow = {
  id: UUID_SF_1,
  household_id: UUID_HH,
  class_id: UUID_CLASS_1,
  target_cents: 300_000,
  target_date: "2028-03-01",
  monthly_contribution_cents: 10_000,
  created_at: NOW,
  updated_at: NOW,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/sinking-funds-tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 INIT_ERROR when getServerSupabaseClient returns null", async () => {
    (getServerSupabaseClient as Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INIT_ERROR");
  });

  it("should return 401 UNAUTHENTICATED when auth.getUser() returns null user", async () => {
    const mockClient = makeMockSupabase({ user: null });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 401 when auth.getUser() returns an error", async () => {
    const mockClient = makeMockSupabase({
      user: null,
      authError: { message: "JWT expired" },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("should return 200 with { tree: [] } for authenticated user with no funds", async () => {
    const mockClient = makeMockSupabase({ user: { id: UUID_USER } });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("tree");
    expect(body.tree).toEqual([]);
  });

  it("should return 200 with correct SinkingFundTreeNode[] for 1 fund, 1 category, 2 classes (one fondo_breve with sf row, one addebito_immediato)", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: [fundRow], error: null },
      categoriesResult: { data: [categoryRow], error: null },
      classesResult: { data: [classRowFondoBreve, classRowAddebitoImm], error: null },
      sinkingFundsResult: { data: [sinkingFundRow], error: null },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toHaveProperty("tree");
    const tree = body.tree;
    expect(tree).toHaveLength(1);

    const fundNode = tree[0];
    expect(fundNode.name).toBe("Fondo Risparmio");
    expect(fundNode.target_amount_cents).toBe(500_000);
    expect(fundNode.current_amount_cents).toBe(120_000);
    expect(fundNode.categories).toHaveLength(1);

    const catNode = fundNode.categories[0];
    expect(catNode.name).toBe("Accantonamento Casa");
    expect(catNode.target_amount_cents).toBe(400_000);
    expect(catNode.current_amount_cents).toBe(100_000);
    // CategoryTreeNode must not expose default_account_id (ADR-0006 Decision 1)
    expect(catNode).not.toHaveProperty("default_account_id");
    expect(catNode.classes).toHaveLength(2);

    // First class: fondo_breve with sinking_fund payload
    const fondoBreveNode = catNode.classes[0];
    expect(fondoBreveNode.tipologia).toBe("fondo_breve");
    expect(fondoBreveNode.sinking_fund).toEqual({
      target_cents: 300_000,
      target_date: "2028-03-01",
      monthly_contribution_cents: 10_000,
    });
    // ClassNode must not expose amount columns (ADR-0006 Decision 1)
    expect(fondoBreveNode).not.toHaveProperty("target_amount_cents");
    expect(fondoBreveNode).not.toHaveProperty("current_amount_cents");

    // Second class: addebito_immediato with sinking_fund: null
    const addebitoNode = catNode.classes[1];
    expect(addebitoNode.tipologia).toBe("addebito_immediato");
    expect(addebitoNode.sinking_fund).toBeNull();
  });

  it("should return 500 QUERY_ERROR on DB error fetching funds", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: {
        data: null,
        error: { code: "PGRST301", message: "relation does not exist" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("QUERY_ERROR");
    // No stack traces or internal messages in the response
    expect(body).not.toHaveProperty("stack");
  });

  it("should return 500 QUERY_ERROR on DB error fetching categories", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: [fundRow], error: null },
      categoriesResult: {
        data: null,
        error: { code: "PGRST301", message: "timeout" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("QUERY_ERROR");
  });

  it("should return 500 QUERY_ERROR on DB error fetching classes", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: [fundRow], error: null },
      categoriesResult: { data: [categoryRow], error: null },
      classesResult: {
        data: null,
        error: { code: "PGRST301", message: "permission denied" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("QUERY_ERROR");
  });

  it("should return 500 QUERY_ERROR on DB error fetching sinking_funds", async () => {
    const mockClient = makeMockSupabase({
      user: { id: UUID_USER },
      fundsResult: { data: [fundRow], error: null },
      categoriesResult: { data: [categoryRow], error: null },
      classesResult: { data: [classRowFondoBreve], error: null },
      sinkingFundsResult: {
        data: null,
        error: { code: "PGRST301", message: "query error" },
      },
    });
    (getServerSupabaseClient as Mock).mockResolvedValue(mockClient);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("QUERY_ERROR");
  });
});
