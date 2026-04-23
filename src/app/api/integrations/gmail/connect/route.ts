import { NextResponse } from "next/server";
import {
  buildConsentUrl,
  loadGmailOAuthConfig,
  GmailOAuthError,
} from "@/lib/ingestion/amex/gmail-oauth";
import { signState } from "@/lib/ingestion/amex/gmail-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "fdf_gmail_oauth_nonce";
const COOKIE_MAX_AGE_SEC = 10 * 60;

// TODO(FDFA-13): sostituire con `resolveSession(req)` quando Auth è live.
// Stub: per lo scaffold accettiamo householdId/userId da header X-FdF-*
// solo se GOOGLE_OAUTH_TEST_MODE=1 — altrimenti 401.
function resolveHouseholdContext(
  req: Request,
): { householdId: string; userId: string } | null {
  if (process.env.GOOGLE_OAUTH_TEST_MODE !== "1") return null;
  const householdId = req.headers.get("x-fdf-household-id");
  const userId = req.headers.get("x-fdf-user-id");
  if (!householdId || !userId) return null;
  return { householdId, userId };
}

export async function GET(req: Request) {
  const ctx = resolveHouseholdContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "unauthorized", hint: "FDFA-13 Auth not wired yet" },
      { status: 401 },
    );
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

  const { state, nonce } = signState({
    householdId: ctx.householdId,
    userId: ctx.userId,
  });

  const consentUrl = buildConsentUrl(config, { state });

  const res = NextResponse.redirect(consentUrl, 302);
  res.cookies.set({
    name: STATE_COOKIE,
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/gmail",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}
