import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

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

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters", code: "BAD_REQUEST" },
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

  // 3. Sign up
  const { data: signUpData, error: signUpError } =
    await supabase.auth.signUp({ email, password });

  if (signUpError || !signUpData.user) {
    return NextResponse.json(
      { error: signUpError?.message ?? "Sign up failed", code: "AUTH_ERROR" },
      { status: 400 },
    );
  }

  // 4. Sign in immediately to guarantee session cookie (defensive: works whether
  //    email confirmation is ON or OFF in the Supabase project settings).
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return NextResponse.json(
      { error: signInError.message, code: "AUTH_ERROR" },
      { status: 400 },
    );
  }

  // Resolve authenticated user after sign-in
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json(
      { error: "Failed to resolve user after sign-in", code: "AUTH_ERROR" },
      { status: 500 },
    );
  }

  const userId = userData.user.id;
  const displayName = email.split("@")[0];

  // 5. Create household via admin client.
  // RLS SELECT blocks the chained .select("id") on the SSR client (user isn't
  // a member yet, so households_select_member filters out the just-inserted row).
  // Service role bypasses RLS entirely — safe here because userId is already
  // validated above via getUser() on the SSR client.
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service unavailable", code: "INIT_ERROR" },
      { status: 500 },
    );
  }

  const { data: householdData, error: householdError } = await admin
    .from("households")
    .insert({ name: `Household di ${displayName}` })
    .select("id")
    .single();

  if (householdError || !householdData) {
    console.error("[api/auth/signup] household insert failed", {
      userId,
      code: householdError?.code,
    });
    return NextResponse.json(
      { error: "Failed to create household", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 6. Bootstrap membership via admin client.
  // household_members_insert_self_or_owner has a recursive subquery in its
  // WITH CHECK that causes infinite recursion (SQLSTATE 42P17) on the SSR client.
  // Admin client bypasses RLS; userId is pinned to the verified auth.uid().
  const { error: memberError } = await admin.from("household_members").insert({
    household_id: householdData.id,
    user_id: userId,
    role: "owner",
    display_name: displayName,
  });

  if (memberError) {
    console.error("[api/auth/signup] household_members insert failed", {
      userId,
      code: memberError.code,
    });
    return NextResponse.json(
      { error: "Failed to create household membership", code: "DB_ERROR" },
      { status: 500 },
    );
  }

  // 7. Success
  return NextResponse.json(
    { success: true, user: userData.user },
    { status: 200 },
  );
}
