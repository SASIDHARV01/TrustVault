import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { documentIdSchema } from "@/lib/document-api";
import {
  createGrantSchema,
  grantIdSchema,
  recipientLookupQuerySchema,
  updateGrantSchema,
} from "@/lib/permission-api";
import {
  createRequestId,
  getApiActor,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import {
  createDocumentGrant,
  listDocumentGrants,
  lookupEligibleRecipient,
  PermissionServiceError,
  revokeDocumentGrant,
  updateDocumentGrant,
} from "@/lib/server/permission-service";

const maximumJsonBytes = 64 * 1024;

type PermissionApiDependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  lookupRecipient: typeof lookupEligibleRecipient;
  listGrants: typeof listDocumentGrants;
  createGrant: typeof createDocumentGrant;
  updateGrant: typeof updateDocumentGrant;
  revokeGrant: typeof revokeDocumentGrant;
};

const defaultDependencies: PermissionApiDependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  lookupRecipient: lookupEligibleRecipient,
  listGrants: listDocumentGrants,
  createGrant: createDocumentGrant,
  updateGrant: updateDocumentGrant,
  revokeGrant: revokeDocumentGrant,
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

function documentNotFound(requestId: string) {
  return errorResponse(
    requestId,
    404,
    "DOCUMENT_NOT_FOUND",
    "Document not found.",
  );
}

async function parseJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (!contentType.startsWith("application/json")) return null;
  if (Number.isFinite(contentLength) && contentLength > maximumJsonBytes) return null;
  if (!request.body) return null;

  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumJsonBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown) {
  return schema.safeParse(body);
}

async function actorOrResponse(
  dependencies: PermissionApiDependencies,
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

async function run(
  requestId: string,
  operation: () => Promise<NextResponse>,
) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PermissionServiceError) {
      switch (error.code) {
        case "DOCUMENT_NOT_FOUND":
          return documentNotFound(requestId);
        case "RECIPIENT_NOT_FOUND":
          return errorResponse(
            requestId,
            404,
            "RECIPIENT_NOT_FOUND",
            "Eligible recipient not found.",
          );
        case "ACTIVE_GRANT_EXISTS":
          return errorResponse(
            requestId,
            409,
            "ACTIVE_GRANT_EXISTS",
            "This recipient already has active access.",
          );
        case "GRANT_NOT_FOUND":
          return errorResponse(
            requestId,
            404,
            "GRANT_NOT_FOUND",
            "Active permission not found.",
          );
        case "GRANT_UNCHANGED":
          return errorResponse(
            requestId,
            409,
            "GRANT_UNCHANGED",
            "The permission already has this access level.",
          );
      }
    }

    console.error("Permission API request failed", { requestId, error });
    return errorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "The request could not be completed.",
    );
  }
}

export function createPermissionApiHandlers(
  overrides: Partial<PermissionApiDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    lookupRecipient: async (request: Request) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const parsed = recipientLookupQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams.entries()),
        );
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "Provide one valid recipient email address.",
          );
        }

        const recipient = await dependencies.lookupRecipient(
          actor,
          parsed.data.email,
        );
        return response(requestId, { data: { recipient } });
      });
    },

    listGrants: async (request: Request, rawDocumentId: string) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) return documentNotFound(requestId);

        const result = await dependencies.listGrants(actor, documentId.data);
        return response(requestId, { data: result });
      });
    },

    createGrant: async (request: Request, rawDocumentId: string) => {
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

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) return documentNotFound(requestId);
        const parsed = parseBody(createGrantSchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The permission data is invalid.",
          );
        }

        const grant = await dependencies.createGrant(
          actor,
          documentId.data,
          parsed.data,
        );
        return response(requestId, { data: { grant } }, 201);
      });
    },

    updateGrant: async (
      request: Request,
      rawDocumentId: string,
      rawGrantId: string,
    ) => {
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

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        const grantId = grantIdSchema.safeParse(rawGrantId);
        if (!documentId.success || !grantId.success) {
          return documentNotFound(requestId);
        }
        const parsed = parseBody(updateGrantSchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The permission data is invalid.",
          );
        }

        const grant = await dependencies.updateGrant(
          actor,
          documentId.data,
          grantId.data,
          parsed.data,
        );
        return response(requestId, { data: { grant } });
      });
    },

    revokeGrant: async (
      request: Request,
      rawDocumentId: string,
      rawGrantId: string,
    ) => {
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

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        const grantId = grantIdSchema.safeParse(rawGrantId);
        if (!documentId.success || !grantId.success) {
          return documentNotFound(requestId);
        }

        const grant = await dependencies.revokeGrant(
          actor,
          documentId.data,
          grantId.data,
        );
        return response(requestId, { data: { grant } });
      });
    },
  };
}

export const permissionApiHandlers = createPermissionApiHandlers();

