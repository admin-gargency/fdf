// Core sync logic per email alert Amex (FDFA-30 M4d).
// Chiamato dal cron /api/cron/amex-email-sync, esegue per ciascuna integration
// Gmail attiva: refresh access token → list messages recenti via query Amex →
// fetch + parse + upsert amex_email_events con ON CONFLICT DO NOTHING per
// dedupe idempotente (PK household_id, msg_id).
//
// Error handling ADR-0005 §5:
//   - 401 / invalid_grant → status='revoked', last_error set, skip integration
//   - altri errori → last_error set, status resta active (retry al cron next hour)
//
// Dep inversion: il sync accetta tutte le dipendenze (fetch, admin client)
// come parametri così i test possono mockarle senza env side-effects.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GmailOAuthError,
  refreshAccessToken,
  type GmailOAuthConfig,
  type GmailTokenBundle,
} from "./gmail-oauth";
import {
  decryptToken,
  encryptToken,
  fromPgHex,
  toPgHex,
} from "../crypto";
import {
  buildAmexAlertQuery,
  gmailMessageToAmexInput,
  type GmailMessage,
} from "./gmail-message";
import { parseAmexEmailAlert } from "./email-alert";

// Shape parziale della riga `integrations` che ci serve.
export interface IntegrationRow {
  id: string;
  household_id: string;
  provider: string;
  account_email: string;
  status: "active" | "revoked" | "error";
  scope: string;
  refresh_token_encrypted: string; // pg hex "\xdeadbeef"
  access_token_encrypted: string | null;
  access_token_expires_at: string | null; // ISO
}

export interface SyncResult {
  integrationId: string;
  accountEmail: string;
  messagesListed: number;
  messagesInserted: number;
  messagesSkippedDuplicate: number;
  messagesUnrecognized: number;
  errors: string[];
  markedRevoked: boolean;
}

export interface SyncDeps {
  admin: SupabaseClient;
  fetchImpl?: typeof fetch;
  config: GmailOAuthConfig;
  now?: () => Date;
  query?: string;
  maxMessagesPerRun?: number;
}

const DEFAULT_MAX_MESSAGES = 50;

export async function syncAllActiveGmailIntegrations(
  deps: SyncDeps,
): Promise<SyncResult[]> {
  const { data, error } = await deps.admin
    .from("integrations")
    .select(
      "id, household_id, provider, account_email, status, scope, " +
        "refresh_token_encrypted, access_token_encrypted, access_token_expires_at",
    )
    .eq("provider", "gmail")
    .eq("status", "active");

  if (error) {
    throw new Error(`integrations_select_failed: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as IntegrationRow[];
  const results: SyncResult[] = [];
  for (const row of rows) {
    results.push(await syncOne(row, deps));
  }
  return results;
}

export async function syncOne(
  integration: IntegrationRow,
  deps: SyncDeps,
): Promise<SyncResult> {
  const result: SyncResult = {
    integrationId: integration.id,
    accountEmail: integration.account_email,
    messagesListed: 0,
    messagesInserted: 0,
    messagesSkippedDuplicate: 0,
    messagesUnrecognized: 0,
    errors: [],
    markedRevoked: false,
  };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  // 1) Ottieni un access token fresco (sempre — costa nulla e ci garantisce
  //    che la finestra di tempo coperta dal cron non cada sopra un'expiry).
  let tokens: GmailTokenBundle;
  try {
    const refreshPlain = decryptToken(
      fromPgHex(integration.refresh_token_encrypted),
    );
    tokens = await refreshAccessToken(deps.config, refreshPlain, fetchImpl);
  } catch (err) {
    await markIntegrationError(deps.admin, integration.id, err, now);
    result.errors.push(describeErr(err));
    if (err instanceof GmailOAuthError && err.code === "token_refresh_failed") {
      await markIntegrationRevoked(deps.admin, integration.id, err);
      result.markedRevoked = true;
    }
    return result;
  }

  // 2) Persisti il nuovo access token cifrato + expiry + clear last_error.
  {
    const encAccess = encryptToken(tokens.accessToken);
    const encRefresh = tokens.refreshToken
      ? encryptToken(tokens.refreshToken)
      : null;
    const update: Record<string, unknown> = {
      access_token_encrypted: toPgHex(encAccess),
      access_token_expires_at: tokens.expiresAt.toISOString(),
      last_error: null,
    };
    if (encRefresh) update.refresh_token_encrypted = toPgHex(encRefresh);
    await deps.admin.from("integrations").update(update).eq("id", integration.id);
  }

  // 3) Lista i messaggi Amex recenti.
  const query = deps.query ?? buildAmexAlertQuery();
  const maxMessages = deps.maxMessagesPerRun ?? DEFAULT_MAX_MESSAGES;
  const listRes = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMessages}&q=${encodeURIComponent(query)}`,
    { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  );

  if (listRes.status === 401) {
    await markIntegrationRevoked(
      deps.admin,
      integration.id,
      new Error("gmail_messages_list_401"),
    );
    result.errors.push("gmail_messages_list_401");
    result.markedRevoked = true;
    return result;
  }

  if (!listRes.ok) {
    const msg = `gmail_messages_list_${listRes.status}`;
    await markIntegrationError(deps.admin, integration.id, new Error(msg), now);
    result.errors.push(msg);
    return result;
  }

  const listJson = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const messages = listJson.messages ?? [];
  result.messagesListed = messages.length;

  // 4) Per ogni messaggio: fetch full + parse + upsert.
  for (const { id } of messages) {
    try {
      const msgRes = await fetchImpl(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { authorization: `Bearer ${tokens.accessToken}` } },
      );
      if (!msgRes.ok) {
        result.errors.push(`msg_fetch_${id}_${msgRes.status}`);
        continue;
      }
      const rawMsg = (await msgRes.json()) as GmailMessage;
      const input = gmailMessageToAmexInput(rawMsg);
      const parsed = parseAmexEmailAlert(input);

      const row = {
        household_id: integration.household_id,
        msg_id: parsed.msgId,
        integration_id: integration.id,
        received_at:
          input.internalDate?.toISOString() ?? now().toISOString(),
        parse_status: parsed.parse_status,
        parse_error: parsed.parse_error,
        parsed_merchant: parsed.merchant_raw,
        parsed_amount_cents: parsed.amount_cents,
        parsed_currency: parsed.currency,
        parsed_card_last4: parsed.card_last4,
        raw_subject: input.subject,
        raw_sender: input.from,
      };

      // Upsert con ignoreDuplicates=true → dedupe su PK (household_id, msg_id).
      const { error: insertErr, count } = await deps.admin
        .from("amex_email_events")
        .upsert(row, {
          onConflict: "household_id,msg_id",
          ignoreDuplicates: true,
          count: "exact",
        });

      if (insertErr) {
        result.errors.push(`upsert_${id}_${insertErr.code}`);
        continue;
      }

      // `count` è null se ignoreDuplicates ha scartato la riga duplicata —
      // contiamo 1 inserted altrimenti.
      if (count === 0 || count === null) {
        result.messagesSkippedDuplicate += 1;
      } else {
        result.messagesInserted += 1;
      }
      if (parsed.parse_status === "unrecognized") {
        result.messagesUnrecognized += 1;
      }
    } catch (err) {
      result.errors.push(`msg_loop_${id}_${describeErr(err)}`);
    }
  }

  // 5) last_synced_at stamp finale.
  await deps.admin
    .from("integrations")
    .update({ last_synced_at: now().toISOString() })
    .eq("id", integration.id);

  return result;
}

// --- helpers -----------------------------------------------------------------

async function markIntegrationError(
  admin: SupabaseClient,
  integrationId: string,
  err: unknown,
  now: () => Date,
): Promise<void> {
  await admin
    .from("integrations")
    .update({
      last_error: describeErr(err).slice(0, 500),
      last_synced_at: now().toISOString(),
    })
    .eq("id", integrationId);
}

async function markIntegrationRevoked(
  admin: SupabaseClient,
  integrationId: string,
  err: unknown,
): Promise<void> {
  await admin
    .from("integrations")
    .update({
      status: "revoked",
      last_error: describeErr(err).slice(0, 500),
    })
    .eq("id", integrationId);
}

function describeErr(err: unknown): string {
  if (err instanceof Error) {
    const tag = err.name === "GmailOAuthError" ? "gmail_oauth" : err.name;
    return `${tag}:${err.message}`;
  }
  return String(err);
}
