import { NextResponse } from "next/server";

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

  // TODO(fdf-waitlist): persist to Supabase `waitlist` table once schema lands
  // (ADR-0003 §3 RLS + admin-client pattern). For now we log server-side only
  // so the landing can ship before the DB is wired.
  console.info(
    JSON.stringify({
      event: "waitlist_signup",
      email_hash: hashEmail(email),
      ts: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ ok: true });
}

function hashEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
