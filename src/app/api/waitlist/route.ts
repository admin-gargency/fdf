import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendWaitlistConfirmation } from "@/lib/waitlist/confirmation-email";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email =
    typeof payload === "object" &&
    payload !== null &&
    "email" in payload &&
    typeof (payload as { email: unknown }).email === "string"
      ? (payload as { email: string }).email.trim().toLowerCase()
      : "";

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const ipHash = ip ? hash(ip) : null;
  const source =
    req.headers.get("referer")?.slice(0, 512) ?? null;

  const admin = getAdminClient();

  if (!admin) {
    // Soft-degrade: log the signup so nothing is lost while env vars are
    // still being provisioned on Vercel (tracked in plan §Next actions).
    console.info(
      JSON.stringify({
        event: "waitlist_signup_degraded",
        reason: "supabase_env_missing",
        email_hash: hash(email),
        ts: new Date().toISOString(),
      }),
    );
    return NextResponse.json({ ok: true, degraded: true });
  }

  const { error } = await admin
    .from("waitlist")
    .upsert(
      {
        email,
        source,
        user_agent: userAgent,
        ip_hash: ipHash,
      },
      { onConflict: "email", ignoreDuplicates: true },
    );

  if (error) {
    console.error(
      JSON.stringify({
        event: "waitlist_signup_failed",
        reason: "supabase_error",
        code: error.code,
        message: error.message,
        ts: new Date().toISOString(),
      }),
    );
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Fire-and-forget confirmation email. Failures are logged but don't break
  // the signup — the user is already in the table.
  sendWaitlistConfirmation(email)
    .then((result) => {
      console.info(
        JSON.stringify({
          event: "waitlist_confirmation_email",
          email_hash: hash(email),
          result,
          ts: new Date().toISOString(),
        }),
      );
      if (result.sent) {
        // Best-effort mark confirmed_at so /admin/waitlist shows who got mail.
        admin
          .from("waitlist")
          .update({ confirmed_at: new Date().toISOString() })
          .eq("email", email)
          .then(() => undefined);
      }
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          event: "waitlist_confirmation_email_error",
          email_hash: hash(email),
          error: err instanceof Error ? err.message : String(err),
          ts: new Date().toISOString(),
        }),
      );
    });

  return NextResponse.json({ ok: true });
}

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
