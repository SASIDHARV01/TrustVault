import { toNextJsHandler } from "better-auth/next-js";

import { isAccountActive } from "@/lib/auth-policy";
import { createRequestId, getAuditRequestContext } from "@/lib/server/api-security";
import { auth } from "@/lib/server/auth";
import { appendAuditEvent } from "@/lib/server/audit-service";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);

export const { GET, PATCH, PUT, DELETE } = handlers;

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  const isSignIn = pathname.endsWith("/sign-in/email");
  const isSignOut = pathname.endsWith("/sign-out");
  if (!isSignIn && !isSignOut) return handlers.POST(request);

  const requestId = createRequestId();
  const context = getAuditRequestContext(request, requestId);
  const bodyRequest = isSignIn ? request.clone() : null;
  const priorSession = isSignOut
    ? await auth.api.getSession({ headers: request.headers })
    : null;
  const response = await handlers.POST(request);
  let actorId: string | null = null;

  if (isSignIn && response.ok && bodyRequest) {
    try {
      const body = (await bodyRequest.json()) as { email?: unknown };
      if (typeof body.email === "string") {
        const user = await getDatabase().user.findUnique({
          where: { email: body.email.trim().toLowerCase() },
          select: { id: true, disabledAt: true },
        });
        if (user && isAccountActive(user.disabledAt)) actorId = user.id;
      }
    } catch {
      actorId = null;
    }
  } else if (isSignOut && priorSession) {
    actorId = priorSession.user.id;
  }

  await appendAuditEvent({
    actorId,
    action: isSignIn ? "AUTH_SIGN_IN" : "AUTH_SIGN_OUT",
    outcome: response.ok ? "ALLOWED" : "DENIED",
    resource: "AUTH",
    targetId: isSignIn ? "CREDENTIAL_SIGN_IN" : "CURRENT_SESSION",
    reason: `HTTP_${response.status}`,
    context,
  });

  return response;
}
