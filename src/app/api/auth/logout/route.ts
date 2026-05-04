import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  // 1. Init SSR client
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  // 2. Sign out — clears session cookie
  await supabase.auth.signOut();

  // 3. Success
  return NextResponse.json({ success: true }, { status: 200 });
}
