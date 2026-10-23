import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { getLoginPath } from "@/lib/auth-policy";
import { protectedContentSecurityPolicy } from "@/lib/security-headers";

function isProtectedWorkspace(pathname: string) {
  return pathname === "/vault" || pathname.startsWith("/vault/") ||
    pathname === "/admin" || pathname.startsWith("/admin/");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = protectedContentSecurityPolicy(nonce);

  // This is only an optimistic navigation check. Protected pages and APIs must
  // still validate the database session; a cookie by itself grants no access.
  if (
    isProtectedWorkspace(request.nextUrl.pathname) &&
    !getSessionCookie(request, { cookiePrefix: "trustvault" })
  ) {
    const redirect = NextResponse.redirect(
      new URL(
        getLoginPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
        request.url,
      ),
    );
    redirect.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return redirect;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  if (isProtectedWorkspace(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: [
    "/vault/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
