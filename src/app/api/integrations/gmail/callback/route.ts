import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  loadGmailOAuthConfig,
  GmailOAuthError,
} from "@/lib/ingestion/amex/gmail-oauth";
import {
  GmailStateError,
  verifyState,
} from "@/lib/ingestion/amex/gmail-state";
import { encryptToken, toPgHex } from "@/lib/ingestion/crypto";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "fdf_gmail_oauth_nonce";
const UI_SUCCESS_REDIRECT = "/settings/integrations?gmail=connected";
const UI_FAILURE_REDIRECT = "/settings/integrations?gmail=error";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) {
    // Utente ha cliccato "Cancel" sul consent screen, o Google ha rifiutato.
    return NextResponse.redirect(
      new URL(`${UI_FAILURE_REDIRECT}&reason=${encodeURIComponent(googleError)}`, req.url),
      302,
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "missing_code_or_state" },
      { status: 400 },
    );
  }

  const nonceCookie = cookieValue(req, STATE_COOKIE);
  if (!nonceCookie) {
    return NextResponse.json(
      { error: "missing_state_cookie" },
      { status: 400 },
    );
  }

  let payload;
  try {
    payload = verifyState(state, nonceCookie);
  } catch (err) {
    if (err instanceof GmailStateError) {
      return NextResponse.json(
        { error: "invalid_state", code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  let config;
  try {
    config = loadGmailOAuthConfig();
  } catch (err) {
    if (err instanceof GmailOAuthError) {
      return NextResponse.json(
        { error: "config_missing", code: err.code },
        { status: 503 },
      );
    }
    throw err;
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(config, code);
  } catch (err) {
    if (err instanceof GmailOAuthError) {
      return NextResponse.json(
        {
          error: "token_exchange_failed",
          code: err.code,
          status: err.status ?? null,
        },
        { status: 502 },
      );
    }
    throw err;
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "supabase_env_missing" },
      { status: 503 },
    );
  }

  const accountEmail = await fetchConnectedEmail(tokens.accessToken).catch(
    () => null,
  );
  if (!accountEmail) {
    return NextResponse.json(
      { error: "account_email_fetch_failed" },
      { status: 502 },
    );
  }

  if (!tokens.refreshToken) {
    return NextResponse.json(
      { error: "missing_refresh_token" },
      { status: 502 },
    );
  }

  const refreshCipher = encryptToken(tokens.refreshToken);
  const accessCipher = encryptToken(tokens.accessToken);

  const { error: upsertError } = await admin.from("integrations").upsert(
    {
      household_id: payload.householdId,
      provider: "gmail",
      account_email: accountEmail,
      status: "active",
      scope: tokens.scope,
      refresh_token_encrypted: toPgHex(refreshCipher),
      access_token_encrypted: toPgHex(accessCipher),
      access_token_expires_at: tokens.expiresAt.toISOString(),
      last_error: null,
      connected_by_user_id: payload.userId,
    },
    { onConflict: "household_id,provider,account_email" },
  );

  if (upsertError) {
    return NextResponse.json(
      {
        error: "integration_upsert_failed",
        code: upsertError.code,
        message: upsertError.message,
      },
      { status: 500 },
    );
  }

  const redirectRes = NextResponse.redirect(
    new URL(UI_SUCCESS_REDIRECT, req.url),
    302,
  );
  redirectRes.cookies.set({
    name: STATE_COOKIE,
    value: "",
    path: "/api/integrations/gmail",
    maxAge: 0,
  });
  return redirectRes;
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const piece of header.split(";")) {
    const [k, ...rest] = piece.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

// Chiama Gmail userinfo per risolvere l'email dell'account connesso.
// Scope gmail.readonly non include `userinfo.email` — usiamo `users.getProfile`
// che sotto gmail.readonly è ammesso e restituisce `emailAddress`.
async function fetchConnectedEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { emailAddress?: string };
  return data.emailAddress ?? null;
}
