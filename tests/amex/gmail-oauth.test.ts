import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConsentUrl,
  exchangeCodeForTokens,
  generateState,
  GMAIL_READONLY_SCOPE,
  GmailOAuthError,
  loadGmailOAuthConfig,
  refreshAccessToken,
} from "../../src/lib/ingestion/amex/gmail-oauth";

const config = {
  clientId: "cid.apps.googleusercontent.com",
  clientSecret: "SECRET",
  redirectUri: "https://fdf.gargency.com/api/integrations/gmail/callback",
};

describe("buildConsentUrl", () => {
  it("emits required OAuth params with the readonly scope", () => {
    const url = new URL(buildConsentUrl(config, { state: "st" }));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("passes login_hint when provided", () => {
    const url = new URL(
      buildConsentUrl(config, { state: "st", loginHint: "ceo@gargency.com" }),
    );
    expect(url.searchParams.get("login_hint")).toBe("ceo@gargency.com");
  });
});

describe("generateState", () => {
  it("returns a URL-safe string without padding and is unique across calls", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("loadGmailOAuthConfig", () => {
  it("throws missing_config when any env var is absent", () => {
    expect(() =>
      loadGmailOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: "x" } as unknown as NodeJS.ProcessEnv),
    ).toThrowError(expect.objectContaining({ code: "missing_config" }));
  });

  it("builds a config when all three vars are set", () => {
    const parsed = loadGmailOAuthConfig({
      GOOGLE_OAUTH_CLIENT_ID: "cid",
      GOOGLE_OAUTH_CLIENT_SECRET: "cs",
      GOOGLE_OAUTH_REDIRECT_URI: "https://x/y",
    } as unknown as NodeJS.ProcessEnv);
    expect(parsed).toEqual({
      clientId: "cid",
      clientSecret: "cs",
      redirectUri: "https://x/y",
    });
  });
});

describe("exchangeCodeForTokens", () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  function okResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("returns a token bundle with a refresh token", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        access_token: "acc",
        refresh_token: "ref",
        expires_in: 3600,
        scope: GMAIL_READONLY_SCOPE,
        token_type: "Bearer",
      }),
    );
    const bundle = await exchangeCodeForTokens(
      config,
      "code",
      fetchMock as unknown as typeof fetch,
    );
    expect(bundle.accessToken).toBe("acc");
    expect(bundle.refreshToken).toBe("ref");
    expect(bundle.scope).toBe(GMAIL_READONLY_SCOPE);
    expect(bundle.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws missing_refresh_token when Google omits it", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        access_token: "acc",
        expires_in: 3600,
        scope: GMAIL_READONLY_SCOPE,
        token_type: "Bearer",
      }),
    );
    await expect(
      exchangeCodeForTokens(config, "code", fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "missing_refresh_token" });
  });

  it("wraps HTTP errors in GmailOAuthError.token_exchange_failed", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      exchangeCodeForTokens(config, "code", fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({
      code: "token_exchange_failed",
      status: 400,
    });
  });
});

describe("refreshAccessToken", () => {
  it("reuses existing refresh_token if Google does not rotate", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "new_acc",
            expires_in: 3600,
            scope: GMAIL_READONLY_SCOPE,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const bundle = await refreshAccessToken(
      config,
      "old_refresh",
      fetchMock as unknown as typeof fetch,
    );
    expect(bundle.accessToken).toBe("new_acc");
    expect(bundle.refreshToken).toBe("old_refresh");
  });

  it("wraps HTTP errors as token_refresh_failed", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      refreshAccessToken(
        config,
        "old_refresh",
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toSatisfy((err) => err instanceof GmailOAuthError && err.code === "token_refresh_failed");
  });
});
