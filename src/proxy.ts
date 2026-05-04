import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};

export async function proxy(req: NextRequest) {
  // ── 1. Kill switch (FIRST — always) ──────────────────────────────────────
  if (process.env.MAINTENANCE_MODE === "1") {
    return new NextResponse(
      JSON.stringify({
        status: "maintenance",
        service: "fdf",
        message: "FdF is temporarily offline for maintenance.",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "600",
          "cache-control": "no-store",
        },
      },
    );
  }

  const path = req.nextUrl.pathname;

  // ── 2. /admin basic auth (SECOND) ────────────────────────────────────────
  if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
      return new NextResponse("admin_not_configured", {
        status: 503,
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      });
    }
    const header = req.headers.get("authorization") ?? "";
    if (!isValidBasic(header, secret)) {
      return new NextResponse("auth_required", {
        status: 401,
        headers: {
          "www-authenticate": 'Basic realm="fdf-admin"',
          "content-type": "text/plain",
          "cache-control": "no-store",
        },
      });
    }
  }

  // ── 3. Auth redirect (THIRD — only for relevant paths) ───────────────────
  const needsAuthCheck =
    path.startsWith("/funds") ||
    path === "/login" ||
    path === "/signup";

  // response is declared here so security headers can be applied to it,
  // including when cookies are refreshed by the Supabase client setAll.
  let response = NextResponse.next({ request: req });

  if (needsAuthCheck) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && anonKey) {
      const supabase = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Double-write: request first (for upstream handlers), then response
            // (so the browser receives refreshed session tokens).
            cookiesToSet.forEach(({ name, value }) =>
              req.cookies.set(name, value),
            );
            response = NextResponse.next({ request: req });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (path.startsWith("/funds") && !user) {
        return NextResponse.redirect(new URL("/login", req.url));
      }

      if ((path === "/login" || path === "/signup") && user) {
        return NextResponse.redirect(new URL("/funds", req.url));
      }
    }
    // Fail-safe: if env vars missing, fall through without redirect.
  }

  // ── 4. Security headers (LAST — applied to all non-redirected responses) ─
  response.headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains",
  );
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(self 'https://checkout.stripe.com')",
  );
  return response;
}

function isValidBasic(header: string, secret: string): boolean {
  if (!header.startsWith("Basic ")) return false;
  const encoded = header.slice(6).trim();
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const password = decoded.slice(sep + 1);
  return constantTimeEqual(password, secret);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
