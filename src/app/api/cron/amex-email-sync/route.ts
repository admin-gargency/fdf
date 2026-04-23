import { NextResponse } from "next/server";
import { loadGmailOAuthConfig, GmailOAuthError } from "@/lib/ingestion/amex/gmail-oauth";
import { syncAllActiveGmailIntegrations } from "@/lib/ingestion/amex/sync";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // Fluid Compute default, reso esplicito.

// Vercel Cron invia automaticamente `authorization: Bearer $CRON_SECRET`
// quando `CRON_SECRET` è settato come env var. Verifichiamo solo in prod —
// in dev un curl senza header deve poter triggerare il job per debug.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "supabase_env_missing" },
      { status: 503 },
    );
  }

  const started = Date.now();
  try {
    const results = await syncAllActiveGmailIntegrations({ admin, config });
    const summary = {
      event: "amex.email.sync.completed",
      integrations: results.length,
      totalMessagesListed: results.reduce((a, r) => a + r.messagesListed, 0),
      totalMessagesInserted: results.reduce((a, r) => a + r.messagesInserted, 0),
      totalMessagesSkippedDuplicate: results.reduce(
        (a, r) => a + r.messagesSkippedDuplicate,
        0,
      ),
      totalMessagesUnrecognized: results.reduce(
        (a, r) => a + r.messagesUnrecognized,
        0,
      ),
      totalErrors: results.reduce((a, r) => a + r.errors.length, 0),
      revokedIntegrations: results.filter((r) => r.markedRevoked).length,
      durationMs: Date.now() - started,
    };
    process.stdout.write(JSON.stringify(summary) + "\n");
    return NextResponse.json({ ok: true, ...summary, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "sync_failed", message: msg, durationMs: Date.now() - started },
      { status: 500 },
    );
  }
}
