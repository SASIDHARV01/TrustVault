import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  contentDisposition,
  MAXIMUM_DOCUMENT_BYTES,
  MAXIMUM_MULTIPART_BYTES,
  parseContentLength,
} from "@/lib/document-content";
import { documentIdSchema } from "@/lib/document-api";
import {
  createRequestId,
  getApiActor,
  getAuditRequestContext,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import type { AuditRequestContext } from "@/lib/server/audit-service";
import {
  createDocumentVersion,
  DocumentContentServiceError,
  getDocumentVersionContent,
  listDocumentVersions,
} from "@/lib/server/document-content-service";

const versionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

type DocumentContentApiDependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  createVersion: (
    actor: ApiActor,
    documentId: string,
    candidate: Parameters<typeof createDocumentVersion>[2],
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof createDocumentVersion>;
  listVersions: (
    actor: ApiActor,
    documentId: string,
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof listDocumentVersions>;
  getContent: (
    actor: ApiActor,
    documentId: string,
    versionId: string,
    disposition: "inline" | "attachment",
    adminOverrideReason: string | null,
    auditContext: AuditRequestContext,
  ) => ReturnType<typeof getDocumentVersionContent>;
};

const defaultDependencies: DocumentContentApiDependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  createVersion: (actor, documentId, candidate, context) =>
    createDocumentVersion(actor, documentId, candidate, undefined, undefined, context),
  listVersions: (actor, documentId, context) =>
    listDocumentVersions(actor, documentId, undefined, context),
  getContent: (
    actor,
    documentId,
    versionId,
    disposition,
    adminOverrideReason,
    context,
  ) =>
    getDocumentVersionContent(
      actor,
      documentId,
      versionId,
      disposition,
      adminOverrideReason,
      undefined,
      undefined,
      context,
    ),
};

function jsonResponse(requestId: string, body: unknown, status = 200) {
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
  return jsonResponse(requestId, { error: { code, message } }, status);
}

function notFound(requestId: string) {
  return errorResponse(requestId, 404, "DOCUMENT_NOT_FOUND", "Document not found.");
}

async function actorOrResponse(
  dependencies: DocumentContentApiDependencies,
  requestId: string,
) {
  const actor = await dependencies.getActor();
  return actor ?? errorResponse(
    requestId,
    401,
    "AUTHENTICATION_REQUIRED",
    "Authentication required.",
  );
}

function isResponse(value: ApiActor | NextResponse): value is NextResponse {
  return value instanceof Response;
}

function serviceErrorResponse(requestId: string, error: DocumentContentServiceError) {
  if (error.code === "DOCUMENT_NOT_FOUND" || error.code === "VERSION_NOT_FOUND") {
    return notFound(requestId);
  }
  if (error.code === "INVALID_UPLOAD") {
    return errorResponse(
      requestId,
      400,
      error.validationCode ?? "INVALID_UPLOAD",
      "The uploaded file is invalid or unsupported.",
    );
  }
  if (error.code === "CONTENT_INTEGRITY_FAILED") {
    return errorResponse(
      requestId,
      409,
      "CONTENT_UNAVAILABLE",
      "The document content failed its integrity check.",
    );
  }
  return errorResponse(
    requestId,
    503,
    "STORAGE_UNAVAILABLE",
    "Document storage is temporarily unavailable.",
  );
}

export function createDocumentContentApiHandlers(
  overrides: Partial<DocumentContentApiDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    upload: async (request: Request, rawDocumentId: string) => {
      const requestId = createRequestId();
      try {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;
        if (!dependencies.trustedMutationOrigin(request)) {
          return errorResponse(requestId, 403, "UNTRUSTED_ORIGIN", "The request origin is not trusted.");
        }
        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) return notFound(requestId);
        const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
        const contentLength = parseContentLength(request);
        if (
          !contentType.startsWith("multipart/form-data;") ||
          (contentLength !== null && contentLength > MAXIMUM_MULTIPART_BYTES)
        ) {
          return errorResponse(requestId, 400, "INVALID_UPLOAD", "The upload request is invalid.");
        }

        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return errorResponse(requestId, 400, "INVALID_UPLOAD", "The upload request is invalid.");
        }
        const entries = formData.getAll("file");
        if (entries.length !== 1 || !(entries[0] instanceof File)) {
          return errorResponse(requestId, 400, "INVALID_UPLOAD", "Provide exactly one file.");
        }
        if ([...formData.keys()].some((key) => key !== "file")) {
          return errorResponse(requestId, 400, "INVALID_UPLOAD", "Unexpected upload fields were provided.");
        }
        const file = entries[0];
        const bytes = file.size > MAXIMUM_DOCUMENT_BYTES
          ? new Uint8Array()
          : new Uint8Array(await file.arrayBuffer());
        const version = await dependencies.createVersion(
          actor,
          documentId.data,
          {
            originalFilename: file.name,
            declaredMimeType: file.type,
            bytes,
            reportedSize: file.size,
          },
          getAuditRequestContext(request, requestId),
        );
        return jsonResponse(requestId, { data: { version } }, 201);
      } catch (error) {
        if (error instanceof DocumentContentServiceError) {
          return serviceErrorResponse(requestId, error);
        }
        console.error("Document upload request failed", { requestId, error });
        return errorResponse(requestId, 500, "INTERNAL_ERROR", "The request could not be completed.");
      }
    },

    listVersions: async (request: Request, rawDocumentId: string) => {
      const requestId = createRequestId();
      try {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;
        const documentId = documentIdSchema.safeParse(rawDocumentId);
        if (!documentId.success) return notFound(requestId);
        const versions = await dependencies.listVersions(
          actor,
          documentId.data,
          getAuditRequestContext(request, requestId),
        );
        return jsonResponse(requestId, { data: { versions } });
      } catch (error) {
        if (error instanceof DocumentContentServiceError) {
          return serviceErrorResponse(requestId, error);
        }
        console.error("Document version list request failed", { requestId, error });
        return errorResponse(requestId, 500, "INTERNAL_ERROR", "The request could not be completed.");
      }
    },

    getContent: async (
      request: Request,
      rawDocumentId: string,
      rawVersionId: string,
    ) => {
      const requestId = createRequestId();
      try {
        const actor = await actorOrResponse(dependencies, requestId);
        if (isResponse(actor)) return actor;
        const documentId = documentIdSchema.safeParse(rawDocumentId);
        const versionId = versionIdSchema.safeParse(rawVersionId);
        if (!documentId.success || !versionId.success) return notFound(requestId);
        const disposition = new URL(request.url).searchParams.get("disposition") === "attachment"
          ? "attachment"
          : "inline";
        const adminOverrideReason = request.headers
          .get("x-trustvault-override-reason")
          ?.trim() || null;
        const content = await dependencies.getContent(
          actor,
          documentId.data,
          versionId.data,
          disposition,
          adminOverrideReason,
          getAuditRequestContext(request, requestId),
        );
        return new Response(content.body, {
          status: 200,
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Cookie, X-TrustVault-Override-Reason",
            "X-Request-ID": requestId,
            "Content-Type": content.mimeType,
            "Content-Length": String(content.sizeBytes),
            "Content-Disposition": contentDisposition(disposition, content.filename),
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        if (error instanceof DocumentContentServiceError) {
          return serviceErrorResponse(requestId, error);
        }
        console.error("Document content request failed", { requestId, error });
        return errorResponse(requestId, 500, "INTERNAL_ERROR", "The request could not be completed.");
      }
    },
  };
}

export const documentContentApiHandlers = createDocumentContentApiHandlers();
