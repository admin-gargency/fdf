import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};

export function proxy(_req: NextRequest) {
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
