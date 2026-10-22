import "server-only";

import { NextResponse } from "next/server";

import {
  adminActivityQuerySchema,
  documentActivityQuerySchema,
} from "@/lib/audit-api";
import { documentIdSchema } from "@/lib/document-api";
import {
  ActivityServiceError,
  listDocumentActivity,
  listSystemActivity,
  verifySystemAudit,
} from "@/lib/server/activity-service";
import {
  createRequestId,
  getApiActor,
  getAuditRequestContext,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import type { AuditRequestContext } from "@/lib/server/audit-service";

type ActivityApiDependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  listDocument: (
    actor: ApiActor,
    documentId: string,
    query: Parameters<typeof listDocumentActivity>[2],
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof listDocumentActivity>;
  listSystem: (
    actor: ApiActor,
    query: Parameters<typeof listSystemActivity>[1],
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof listSystemActivity>;
  verifySystem: (
    actor: ApiActor,
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof verifySystemAudit>;
};

const defaultDependencies: ActivityApiDependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  listDocument: (actor, documentId, query, context) =>
    listDocumentActivity(actor, documentId, query, undefined, context),
  listSystem: (actor, query, context) =>
    listSystemActivity(actor, query, undefined, context),
  verifySystem: (actor, context) => verifySystemAudit(actor, undefined, context),
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

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return response(requestId, { error: { code, message } }, status);
}

async function actorOrResponse(
  dependencies: ActivityApiDependencies,
  requestId: string,
) {
  const actor = await dependencies.getActor();
  return (
    actor ??
    errorResponse(
      requestId,
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication required.",
    )
  );
}

function isResponse(value: ApiActor | NextResponse): value is NextResponse {
  return value instanceof Response;
}

async function run(requestId: string, operation: () => Promise<NextResponse>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ActivityServiceError) {
      if (error.code === "DOCUMENT_NOT_FOUND") {
        return errorResponse(
          requestId,
          404,
          "DOCUMENT_NOT_FOUND",
          "Document not found.",
        );
      }
      return errorResponse(
        requestId,
        403,
        "ADMIN_REQUIRED",
        "Administrator access required.",
      );
    }

    console.error("Activity API request failed", { requestId, error });
    return errorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "The request could not be completed.",
    );
  }
}

export function createActivityApiHandlers(
  overrides: Partial<ActivityApiDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    listDocument: async (request: Request, rawDocumentId: string) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) {
          return errorResponse(
            requestId,
            404,
            "DOCUMENT_NOT_FOUND",
            "Document not found.",
          );
        }
        const query = documentActivityQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams.entries()),
        );
        if (!query.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The activity query is invalid.",
          );
        }

        const result = await dependencies.listDocument(
          actor,
          documentId.data,
          query.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: result });
      });
    },

    listSystem: async (request: Request) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const query = adminActivityQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams.entries()),
        );
        if (!query.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The activity query is invalid.",
          );
        }

        const result = await dependencies.listSystem(
          actor,
          query.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: result });
      });
    },

    verifySystem: async (request: Request) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;
        if (!dependencies.trustedMutationOrigin(request)) {
          return errorResponse(
            requestId,
            403,
            "UNTRUSTED_ORIGIN",
            "The request origin is not trusted.",
          );
        }

        const verification = await dependencies.verifySystem(
          actor,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: { verification } });
      });
    },
  };
}

export const activityApiHandlers = createActivityApiHandlers();

