import "server-only";

import { NextResponse } from "next/server";

import {
  createRequestId,
  getApiActor,
  getAuditRequestContext,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import type { AuditRequestContext } from "@/lib/server/audit-service";
import {
  AuditCheckpointServiceError,
  createAuditCheckpoint,
  listAuditCheckpoints,
} from "@/lib/server/audit-checkpoint-service";

type Dependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  createCheckpoint: (
    actor: ApiActor,
    context: AuditRequestContext,
  ) => ReturnType<typeof createAuditCheckpoint>;
  listCheckpoints: (
    actor: ApiActor,
    context: AuditRequestContext,
  ) => ReturnType<typeof listAuditCheckpoints>;
};

const defaults: Dependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  createCheckpoint: (actor, context) => createAuditCheckpoint(actor, undefined, undefined, context),
  listCheckpoints: (actor, context) => listAuditCheckpoints(actor, undefined, context),
};

function response(requestId: string, body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Request-ID": requestId,
    },
  });
}

export function createAuditCheckpointApiHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };

  async function run(request: Request, create: boolean) {
    const requestId = createRequestId();
    try {
      const actor = await dependencies.getActor();
      if (!actor) {
        return response(requestId, { error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required." } }, 401);
      }
      if (create && !dependencies.trustedMutationOrigin(request)) {
        return response(requestId, { error: { code: "UNTRUSTED_ORIGIN", message: "The request origin is not trusted." } }, 403);
      }
      const context = getAuditRequestContext(request, requestId);
      if (create) {
        const checkpoint = await dependencies.createCheckpoint(actor, context);
        return response(requestId, { data: { checkpoint } }, 201);
      }
      const checkpoints = await dependencies.listCheckpoints(actor, context);
      return response(requestId, { data: { checkpoints } });
    } catch (error) {
      if (error instanceof AuditCheckpointServiceError) {
        if (error.code === "ADMIN_REQUIRED") {
          return response(requestId, { error: { code: "ADMIN_REQUIRED", message: "Administrator access required." } }, 403);
        }
        if (error.code === "CHAIN_INVALID") {
          return response(requestId, { error: { code: "CHAIN_INVALID", message: "The audit chain failed verification." } }, 409);
        }
        if (error.code === "NO_AUDIT_EVENTS") {
          return response(requestId, { error: { code: "NO_AUDIT_EVENTS", message: "There are no audit events to checkpoint." } }, 409);
        }
        return response(requestId, { error: { code: "STORAGE_UNAVAILABLE", message: "Checkpoint storage is temporarily unavailable." } }, 503);
      }
      console.error("Audit checkpoint request failed", { requestId, error });
      return response(requestId, { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
    }
  }

  return {
    list: (request: Request) => run(request, false),
    create: (request: Request) => run(request, true),
  };
}

export const auditCheckpointApiHandlers = createAuditCheckpointApiHandlers();
