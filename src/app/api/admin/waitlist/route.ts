import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WaitlistRow = {
  id: string;
  email: string;
  source: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "supabase_env_missing" }, { status: 503 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";

  const { data, error, count } = await admin
    .from("waitlist")
    .select("id, email, source, user_agent, ip_hash, confirmed_at, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "supabase_error", code: error.code, message: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as WaitlistRow[];

  if (format === "csv") {
    const header = [
      "email",
      "confirmed_at",
      "source",
      "created_at",
      "ip_hash",
    ].join(",");
    const body = rows
      .map((r) =>
        [
          csvField(r.email),
          csvField(r.confirmed_at ?? ""),
          csvField(r.source ?? ""),
          csvField(r.created_at),
          csvField(r.ip_hash ?? ""),
        ].join(","),
      )
      .join("\n");
    const filename = `fdf-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(header + "\n" + body + "\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({ count: count ?? rows.length, rows });
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
