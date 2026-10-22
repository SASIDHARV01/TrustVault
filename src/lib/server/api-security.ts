import "server-only";

import { randomUUID } from "node:crypto";

import type { AuthorizationSystemRole } from "@/lib/document-authorization";
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

