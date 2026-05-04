import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Parse + validate body
  let email: string, password: string;
  try {
    const body = await request.json();
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  // 2. Init SSR client
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  // 3. Sign in
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      {
        error: error?.message ?? "Authentication failed",
        code: "INVALID_CREDENTIALS",
      },
      { status: 401 },
    );
  }

  // 4. Success
  return NextResponse.json({ success: true, user: data.user }, { status: 200 });
}
