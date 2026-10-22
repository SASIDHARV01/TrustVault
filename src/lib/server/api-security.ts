import "server-only";

import { randomUUID } from "node:crypto";

import type { AuthorizationSystemRole } from "@/lib/document-authorization";
import type { AuditRequestContext } from "@/lib/server/audit-service";
import { getCurrentSession } from "@/lib/server/session";

export type ApiActor = {
  id: string;
  role: AuthorizationSystemRole;
};

export async function getApiActor(): Promise<ApiActor | null> {
  const session = await getCurrentSession();

  if (!session) return null;

  return {
    id: session.user.id,
    role: session.user.role === "ADMIN" ? "ADMIN" : "MEMBER",
  };
}

export function isTrustedMutationOrigin(request: Request) {
  const configuredUrl = process.env.APP_URL;
  const requestOrigin = request.headers.get("origin");

  if (!configuredUrl || !requestOrigin) return false;

  try {
    return new URL(requestOrigin).origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

export function createRequestId() {
  return randomUUID();
}

export function getAuditRequestContext(
  request: Request,
  requestId: string,
): AuditRequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();

  return {
    requestId,
    ipAddress: (connectingIp || forwardedFor || null)?.slice(0, 45) ?? null,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}

