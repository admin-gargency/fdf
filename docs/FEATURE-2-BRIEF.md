# Feature 2: Auth System — Technical Brief

**Agent**: backend-dev (+ frontend-dev per UI)  
**Deadline**: Overnight → merge main entro mattina  
**Ref**: FdF Agent Teams pilot

---

## Quick Start

```bash
# Already done in Feature 1
cd ~/dev/fdf
git pull origin main

# Feature 2 work starts here
git checkout -b feature/2-auth-system
```

---

## Stack

- **Auth**: Supabase Auth (email/password)
- **Session**: HTTP-only cookies via `@supabase/ssr`
- **Protected routes**: Next.js middleware
- **Client**: `getServerSupabaseClient()` from `src/lib/supabase/server.ts`

---

## Implementation Plan

### 1. Auth Pages (frontend-dev)

**Create `/app/(auth)/login/page.tsx`**:
- Form: email, password, submit
- Call `/api/auth/login` (POST)
- On success: redirect to `/funds`
- On error: show error message
- Link to `/signup`

**Create `/app/(auth)/signup/page.tsx`**:
- Form: email, password, confirm password, submit
- Call `/api/auth/signup` (POST)
- On success: auto-login + redirect to `/funds`
- On error: show error message
- Link to `/login`

**Styling**: Use existing Tailwind classes from `/funds` page (consistency).

---

### 2. Auth API Routes (backend-dev)

**Create `/app/api/auth/signup/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 500 });
  }

  // 1. Sign up user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
    }
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "User ID missing" }, { status: 500 });
  }

  // 2. Create household for new user
  const { data: household, error: householdError } = await supabase
    .from("households")
    .insert({ name: `Household di ${email.split('@')[0]}`, created_at: new Date(), updated_at: new Date() })
    .select()
    .single();

  if (householdError) {
    // Rollback auth? Or log error and continue?
    console.error("[signup] Household creation failed", householdError);
    return NextResponse.json({ error: "Failed to create household" }, { status: 500 });
  }

  // 3. Create household membership
  const { error: memberError } = await supabase
    .from("household_members")
    .insert({
      household_id: household.id,
      user_id: userId,
      role: "owner",
      display_name: email.split('@')[0],
      created_at: new Date(),
      updated_at: new Date()
    });

  if (memberError) {
    console.error("[signup] Membership creation failed", memberError);
    return NextResponse.json({ error: "Failed to create membership" }, { status: 500 });
  }

  return NextResponse.json({ success: true, user: authData.user });
}
```

**Create `/app/api/auth/login/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 500 });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ success: true, user: data.user });
}
```

**Create `/app/api/auth/logout/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 500 });
  }

  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
```

---

### 3. Protected Routes Middleware (backend-dev)

**Create `/middleware.ts`**:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Protect /funds route
  if (request.nextUrl.pathname.startsWith("/funds") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from auth pages
  if ((request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup") && user) {
    return NextResponse.redirect(new URL("/funds", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/funds/:path*", "/login", "/signup"],
};
```

---

## Smoke Test

**Create `docs/SMOKE-TEST-FEATURE-2.md`**:

```markdown
# Feature 2 Smoke Test

**Date**: [inserisci data]  
**Tester**: [agente che ha fatto il test]

## User Journey: Signup → Login → Empty State

### 1. Signup Flow
- [ ] Visita `http://localhost:3000/signup`
- [ ] Compila form: `test@example.com` / password sicura
- [ ] Click "Registrati"
- [ ] Verifica: redirect automatico a `/funds`
- [ ] Verifica: empty state visibile

### 2. Logout + Login Flow
- [ ] Logout (implementa bottone logout)
- [ ] Visita `http://localhost:3000/funds` → redirect a `/login`
- [ ] Compila form login con credenziali sopra
- [ ] Click "Accedi"
- [ ] Verifica: redirect a `/funds`, empty state visibile

### 3. Database Verification
- [ ] Supabase Dashboard → Authentication → Users
- [ ] Verifica: user `test@example.com` presente
- [ ] SQL Editor: `SELECT * FROM households WHERE id IN (SELECT household_id FROM household_members WHERE user_id = '<user-id>');`
- [ ] Verifica: household creato con nome sensato
- [ ] Verifica: membership con role "owner" presente

## Expected Behavior

✅ No 401 errors on `/funds` after login  
✅ No 500 errors on signup/login  
✅ Household auto-created with membership  
✅ Empty state renders correctly  
✅ Protected route redirect works  

## Issues Found

[Documenta qui eventuali problemi riscontrati]
```

---

## Pre-Commit Checklist

- [ ] Login page funzionante (UI + API)
- [ ] Signup page funzionante (UI + API + household creation)
- [ ] Logout funzionante
- [ ] Middleware redirect corretto
- [ ] Smoke test PASS documentato
- [ ] No console errors in browser
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] Code formatted (`pnpm format`)

---

## Commit & Push

```bash
git add .
git commit -m "feat: Feature 2 - Auth system & protected routes

- Add login/signup pages with Supabase Auth
- Add auth API routes (signup, login, logout)
- Add middleware for protected /funds route
- Implement household auto-creation on signup
- Document smoke test in SMOKE-TEST-FEATURE-2.md

Ref: FdF Agent Teams pilot Feature 2"

git push origin feature/2-auth-system

# Then merge to main (or open PR if review needed)
git checkout main
git merge feature/2-auth-system
git push origin main
```

---

## Troubleshooting

### "auth.uid() returns null"
→ Check session cookie is set correctly after login  
→ Verify `getServerSupabaseClient()` uses anon key (NOT service role)  
→ Test with `await supabase.auth.getUser()` in route handler

### "Household creation fails"
→ Check RLS policies on `households` table allow INSERT  
→ Use service role client for household creation (or disable RLS temporarily)  
→ See `src/lib/supabase/admin.ts` for service role client pattern

### "Redirect loop /funds → /login → /funds"
→ Middleware might not be reading session correctly  
→ Check cookie `SameSite` / `Secure` settings in middleware

---

## Resources

- Supabase Auth + Next.js App Router: https://supabase.com/docs/guides/auth/server-side/nextjs
- Middleware patterns: https://nextjs.org/docs/app/building-your-application/routing/middleware
- Cookie patterns with SSR: https://github.com/supabase/auth-helpers/tree/main/examples/nextjs
