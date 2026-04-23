import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  syncOne,
  type IntegrationRow,
  type SyncDeps,
} from "../../src/lib/ingestion/amex/sync";
import { encryptToken, toPgHex } from "../../src/lib/ingestion/crypto";

const KEY_B64 = randomBytes(32).toString("base64");

// --- minimal SupabaseClient mock --------------------------------------------
// Cattura chiamate `.from(table).update(obj).eq(col, val)` e `.from(table)
// .upsert(row, options)` senza richiedere il vero @supabase/supabase-js.
interface Call {
  table: string;
  op: "update" | "upsert";
  payload: unknown;
  match?: { col: string; val: unknown };
  options?: unknown;
}

function makeAdminMock(opts: {
  upsertError?: { code: string; message: string };
  upsertReturnsNoInsert?: boolean;
} = {}) {
  const calls: Call[] = [];

  const thenable = {
    then(resolve: (v: unknown) => void) {
      resolve({ error: null, count: 1 });
    },
  };

  const upsertThenable = (row: unknown, options?: unknown) => {
    const call: Call = { table: currentTable, op: "upsert", payload: row, options };
    calls.push(call);
    return {
      then(resolve: (v: unknown) => void) {
        if (opts.upsertError) {
          resolve({ error: opts.upsertError, count: null });
        } else if (opts.upsertReturnsNoInsert) {
          resolve({ error: null, count: 0 });
        } else {
          resolve({ error: null, count: 1 });
        }
      },
    };
  };

  let currentTable = "";
  const client = {
    from(table: string) {
      currentTable = table;
      return {
        update(payload: unknown) {
          return {
            eq(col: string, val: unknown) {
              calls.push({ table, op: "update", payload, match: { col, val } });
              return thenable;
            },
          };
        },
        upsert(row: unknown, options?: unknown) {
          return upsertThenable(row, options);
        },
      };
    },
  };
  return { client: client as unknown as SyncDeps["admin"], calls };
}

// --- fixture helpers ---------------------------------------------------------

function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalGmailMessage(id: string): unknown {
  const text = `Transazione di EUR 15,00 presso BAR TEST il 15/04/2026 con la Carta terminante con 9999.`;
  return {
    id,
    internalDate: "1744848000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Avviso di spesa" },
        { name: "From", value: "alerts@americanexpress.it" },
      ],
      body: { data: b64url(text), size: text.length },
    },
  };
}

function sampleIntegration(): IntegrationRow {
  const refresh = encryptToken("real_refresh_token", Buffer.from(KEY_B64, "base64"));
  return {
    id: "int-1",
    household_id: "house-1",
    provider: "gmail",
    account_email: "user@example.com",
    status: "active",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    refresh_token_encrypted: toPgHex(refresh),
    access_token_encrypted: null,
    access_token_expires_at: null,
  };
}

const config = {
  clientId: "cid",
  clientSecret: "cs",
  redirectUri: "https://x/y",
};

describe("syncOne", () => {
  const prevKey = process.env.SUPABASE_INGESTION_KMS_KEY;

  beforeEach(() => {
    process.env.SUPABASE_INGESTION_KMS_KEY = KEY_B64;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.SUPABASE_INGESTION_KMS_KEY;
    else process.env.SUPABASE_INGESTION_KMS_KEY = prevKey;
  });

  it("refreshes token, lists + fetches messages, inserts parsed events", async () => {
    const { client, calls } = makeAdminMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "new_access",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        });
      }
      if (url.includes("messages?maxResults")) {
        return jsonResponse({ messages: [{ id: "m1", threadId: "t" }] });
      }
      if (url.includes("messages/m1")) {
        return jsonResponse(canonicalGmailMessage("m1"));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const deps: SyncDeps = {
      admin: client,
      fetchImpl: fetchMock as unknown as typeof fetch,
      config,
      now: () => new Date("2026-04-24T10:00:00Z"),
    };
    const result = await syncOne(sampleIntegration(), deps);

    expect(result.errors).toEqual([]);
    expect(result.messagesListed).toBe(1);
    expect(result.messagesInserted).toBe(1);
    expect(result.messagesSkippedDuplicate).toBe(0);
    expect(result.markedRevoked).toBe(false);

    const upsertCall = calls.find((c) => c.op === "upsert" && c.table === "amex_email_events");
    expect(upsertCall).toBeDefined();
    const row = upsertCall!.payload as Record<string, unknown>;
    expect(row.household_id).toBe("house-1");
    expect(row.msg_id).toBe("m1");
    expect(row.parse_status).toBe("parsed");
    expect(row.parsed_merchant).toBe("BAR TEST");
    expect(row.parsed_amount_cents).toBe(1500);
    expect(row.parsed_card_last4).toBe("9999");
    expect((upsertCall!.options as { onConflict?: string }).onConflict).toBe(
      "household_id,msg_id",
    );

    const lastSyncedUpdate = calls.find(
      (c) => c.op === "update" && (c.payload as Record<string, unknown>).last_synced_at,
    );
    expect(lastSyncedUpdate).toBeDefined();
  });

  it("marks integration revoked when Google refresh returns 400", async () => {
    const { client, calls } = makeAdminMock();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant" }, 400),
    );

    const deps: SyncDeps = {
      admin: client,
      fetchImpl: fetchMock as unknown as typeof fetch,
      config,
    };
    const result = await syncOne(sampleIntegration(), deps);

    expect(result.markedRevoked).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    const revokedUpdate = calls.find(
      (c) => c.op === "update" && (c.payload as { status?: string }).status === "revoked",
    );
    expect(revokedUpdate).toBeDefined();
  });

  it("marks revoked when Gmail messages.list returns 401", async () => {
    const { client, calls } = makeAdminMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "acc",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        });
      }
      return jsonResponse({ error: "invalid_credentials" }, 401);
    });

    const deps: SyncDeps = {
      admin: client,
      fetchImpl: fetchMock as unknown as typeof fetch,
      config,
    };
    const result = await syncOne(sampleIntegration(), deps);
    expect(result.markedRevoked).toBe(true);
    expect(result.errors).toContain("gmail_messages_list_401");
    const revokedUpdate = calls.find(
      (c) => c.op === "update" && (c.payload as { status?: string }).status === "revoked",
    );
    expect(revokedUpdate).toBeDefined();
  });

  it("counts duplicate when upsert returns count=0 (ON CONFLICT DO NOTHING)", async () => {
    const { client } = makeAdminMock({ upsertReturnsNoInsert: true });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "acc",
          expires_in: 3600,
          scope: "s",
          token_type: "Bearer",
        });
      }
      if (url.includes("messages?maxResults")) {
        return jsonResponse({ messages: [{ id: "dup", threadId: "t" }] });
      }
      return jsonResponse(canonicalGmailMessage("dup"));
    });

    const deps: SyncDeps = {
      admin: client,
      fetchImpl: fetchMock as unknown as typeof fetch,
      config,
    };
    const result = await syncOne(sampleIntegration(), deps);
    expect(result.messagesInserted).toBe(0);
    expect(result.messagesSkippedDuplicate).toBe(1);
  });

  it("counts unrecognized when parser fails on a listed message", async () => {
    const { client } = makeAdminMock();
    const badMsg = {
      id: "x",
      internalDate: "1744848000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "promo" },
          { name: "From", value: "alerts@americanexpress.it" },
        ],
        body: {
          data: b64url("Carta terminante con 1111 scade il 31/12/2026."),
          size: 40,
        },
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "acc",
          expires_in: 3600,
          scope: "s",
          token_type: "Bearer",
        });
      }
      if (url.includes("messages?maxResults")) {
        return jsonResponse({ messages: [{ id: "x", threadId: "t" }] });
      }
      return jsonResponse(badMsg);
    });

    const deps: SyncDeps = {
      admin: client,
      fetchImpl: fetchMock as unknown as typeof fetch,
      config,
    };
    const result = await syncOne(sampleIntegration(), deps);
    expect(result.messagesListed).toBe(1);
    expect(result.messagesUnrecognized).toBe(1);
  });
});
