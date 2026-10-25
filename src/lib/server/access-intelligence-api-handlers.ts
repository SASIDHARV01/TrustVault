import "server-only";

import { NextResponse } from "next/server";

import { accessIntelligenceQuerySchema } from "@/lib/access-intelligence-api";
import {
  AccessIntelligenceServiceError,
  listSystemAccessIntelligence,
} from "@/lib/server/access-intelligence-service";
import {
  createRequestId,
  getApiActor,
  getAuditRequestContext,
  type ApiActor,
} from "@/lib/server/api-security";
import type { AuditRequestContext } from "@/lib/server/audit-service";

type Dependencies = {
  getActor: () => Promise<ApiActor | null>;
  list: (
    actor: ApiActor,
    query: Parameters<typeof listSystemAccessIntelligence>[1],
    context: AuditRequestContext,
  ) => ReturnType<typeof listSystemAccessIntelligence>;
};

const defaults: Dependencies = {
  getActor: getApiActor,
  list: (actor, query, context) =>
    listSystemAccessIntelligence(actor, query, undefined, context),
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

export function createAccessIntelligenceApiHandlers(
  overrides: Partial<Dependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  return {
    list: async (request: Request) => {
      const requestId = createRequestId();
      const actor = await dependencies.getActor();
      if (!actor) {
        return response(
          requestId,
          { error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required." } },
          401,
        );
      }
      const query = accessIntelligenceQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success) {
        return response(
          requestId,
          { error: { code: "INVALID_REQUEST", message: "The access query is invalid." } },
          400,
        );
      }
      try {
        const result = await dependencies.list(
          actor,
          query.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: result });
      } catch (error) {
        if (error instanceof AccessIntelligenceServiceError) {
          return response(
            requestId,
            { error: { code: "ADMIN_REQUIRED", message: "Administrator access required." } },
            403,
          );
        }
        console.error("Access intelligence API request failed", { requestId, error });
        return response(
          requestId,
          { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } },
          500,
        );
      }
    },
  };
}

export const accessIntelligenceApiHandlers =
  createAccessIntelligenceApiHandlers();
