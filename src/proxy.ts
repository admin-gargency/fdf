import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};

export function proxy(req: NextRequest) {
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

  const res = NextResponse.next();
  res.headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains",
  );
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(self 'https://checkout.stripe.com')",
  );
  return res;
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
