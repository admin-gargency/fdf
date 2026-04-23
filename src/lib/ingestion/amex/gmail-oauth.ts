// Gmail OAuth 2.0 flow helpers (FDFA-30 §2).
// Scope minimo: https://www.googleapis.com/auth/gmail.readonly (ADR-0005 §D).
// Usa raw fetch contro gli endpoint Google — niente dep `googleapis` per stare leggeri.

import { randomBytes } from "node:crypto";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GmailTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope: string;
  tokenType: string;
}

export class GmailOAuthError extends Error {
  readonly code:
    | "missing_config"
    | "token_exchange_failed"
    | "token_refresh_failed"
    | "missing_refresh_token";
  readonly status?: number;
  readonly details?: unknown;
  constructor(
    code: GmailOAuthError["code"],
    message: string,
    opts: { status?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "GmailOAuthError";
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

export function loadGmailOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GmailOAuthConfig {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GmailOAuthError(
      "missing_config",
      "GOOGLE_OAUTH_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI not set",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export interface ConsentUrlOptions {
  state: string;
  loginHint?: string;
}

// Google: prompt=consent + access_type=offline sono necessari per ottenere
// un refresh_token alla prima authorization (altrimenti Google lo omette dopo
// il primo consenso utente). include_granted_scopes=false perché vogliamo che
// ogni re-consent sia verificabile.
export function buildConsentUrl(
  config: GmailOAuthConfig,
  opts: ConsentUrlOptions,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", opts.state);
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

async function postTokenRequest(
  params: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let details: unknown = text;
    try {
      details = JSON.parse(text);
    } catch {
      // leave as text
    }
    throw new GmailOAuthError(
      "token_exchange_failed",
      `Google token endpoint returned ${res.status}`,
      { status: res.status, details },
    );
  }
  return JSON.parse(text) as GoogleTokenResponse;
}

export async function exchangeCodeForTokens(
  config: GmailOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailTokenBundle> {
  const params = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const json = await postTokenRequest(params, fetchImpl);
  if (!json.refresh_token) {
    // Primo consent dovrebbe restituire refresh_token perché settiamo
    // prompt=consent. Se manca, Google ha silently skippato il re-consent
    // (non dovrebbe mai succedere col nostro flag set, ma defendiamo).
    throw new GmailOAuthError(
      "missing_refresh_token",
      "Google did not return a refresh_token — re-consent required",
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiresAtFrom(json.expires_in),
    scope: json.scope,
    tokenType: json.token_type,
  };
}

export async function refreshAccessToken(
  config: GmailOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailTokenBundle> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const json = await postTokenRequest(params, fetchImpl);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: expiresAtFrom(json.expires_in),
      scope: json.scope,
      tokenType: json.token_type,
    };
  } catch (err) {
    if (err instanceof GmailOAuthError && err.code === "token_exchange_failed") {
      // Per l'uso chiamante la semantica è "refresh" — rinominiamo il code.
      throw new GmailOAuthError("token_refresh_failed", err.message, {
        status: err.status,
        details: err.details,
      });
    }
    throw err;
  }
}

function expiresAtFrom(expiresInSec: number): Date {
  const safeSec = Math.max(0, expiresInSec - 30); // margin di skew
  return new Date(Date.now() + safeSec * 1000);
}
