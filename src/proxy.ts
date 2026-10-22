import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { getLoginPath } from "@/lib/auth-policy";

export function proxy(request: NextRequest) {
  // This is only an optimistic navigation check. Protected pages and APIs must
  // still validate the database session; a cookie by itself grants no access.
  if (!getSessionCookie(request, { cookiePrefix: "trustvault" })) {
    return NextResponse.redirect(
      new URL(
        getLoginPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
        request.url,
      ),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/vault/:path*", "/admin/:path*"],
};
