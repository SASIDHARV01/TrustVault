import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import {
  createDocumentSchema,
  documentIdSchema,
  documentListQuerySchema,
  updateDocumentSchema,
} from "@/lib/document-api";
import {
  createRequestId,
  getApiActor,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import {
  createDocumentMetadata,
  deleteDocument,
  DocumentServiceError,
  getDocumentMetadata,
  listAccessibleDocuments,
  restoreDocument,
  updateDocumentMetadata,
} from "@/lib/server/document-service";

const maximumJsonBytes = 64 * 1024;

type DocumentApiDependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  listDocuments: typeof listAccessibleDocuments;
  createDocument: typeof createDocumentMetadata;
  getDocument: typeof getDocumentMetadata;
  updateDocument: typeof updateDocumentMetadata;
  deleteDocument: typeof deleteDocument;
  restoreDocument: typeof restoreDocument;
};

const defaultDependencies: DocumentApiDependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  listDocuments: listAccessibleDocuments,
  createDocument: createDocumentMetadata,
  getDocument: getDocumentMetadata,
  updateDocument: updateDocumentMetadata,
  deleteDocument,
  restoreDocument,
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

function notFoundResponse(requestId: string) {
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
  dependencies: DocumentApiDependencies,
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
    if (error instanceof DocumentServiceError) {
      if (error.code === "DOCUMENT_NOT_FOUND") return notFoundResponse(requestId);
      if (error.code === "INVALID_CATEGORY") {
        return errorResponse(
          requestId,
          400,
          "INVALID_CATEGORY",
          "The selected category is not available.",
        );
      }
    }

    console.error("Document API request failed", { requestId, error });
    return errorResponse(
      requestId,
      500,
      "INTERNAL_ERROR",
      "The request could not be completed.",
    );
  }
}

export function createDocumentApiHandlers(
  overrides: Partial<DocumentApiDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    list: async (request: Request) => {
      const requestId = createRequestId();

      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const url = new URL(request.url);
        const parsed = documentListQuerySchema.safeParse(
          Object.fromEntries(url.searchParams.entries()),
        );
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The document query is invalid.",
          );
        }

        const result = await dependencies.listDocuments(actor, parsed.data);
        return response(requestId, { data: result });
      });
    },

    create: async (request: Request) => {
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

        const parsed = parseBody(createDocumentSchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The document data is invalid.",
          );
        }

        const document = await dependencies.createDocument(actor, parsed.data);
        return response(requestId, { data: { document } }, 201);
      });
    },

    get: async (request: Request, rawDocumentId: string) => {
      const requestId = createRequestId();

      return run(requestId, async () => {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;

        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) return notFoundResponse(requestId);

        const document = await dependencies.getDocument(actor, documentId.data);
        return response(requestId, { data: { document } });
      });
    },

    update: async (request: Request, rawDocumentId: string) => {
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
        if (!documentId.success) return notFoundResponse(requestId);

        const parsed = parseBody(updateDocumentSchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(
            requestId,
            400,
            "INVALID_REQUEST",
            "The document data is invalid.",
          );
        }

        const document = await dependencies.updateDocument(
          actor,
          documentId.data,
          parsed.data,
        );
        return response(requestId, { data: { document } });
      });
    },

    remove: async (request: Request, rawDocumentId: string) => {
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
        if (!documentId.success) return notFoundResponse(requestId);

        const document = await dependencies.deleteDocument(actor, documentId.data);
        return response(requestId, { data: { document } });
      });
    },

    restore: async (request: Request, rawDocumentId: string) => {
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
        if (!documentId.success) return notFoundResponse(requestId);

        const document = await dependencies.restoreDocument(actor, documentId.data);
        return response(requestId, { data: { document } });
      });
    },
  };
}

export const documentApiHandlers = createDocumentApiHandlers();

