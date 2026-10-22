import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  DocumentUploadValidationError,
  type DocumentUploadCandidate,
  validateDocumentUpload,
} from "@/lib/document-content";
import {
  createDocumentObjectKey,
  ObjectStorageError,
  parseObjectStorageKey,
  type ObjectStorage,
} from "@/lib/object-storage";
import {
  appendAuditEvent,
  appendAuditEventInTransaction,
  type AuditRequestContext,
} from "@/lib/server/audit-service";
import { getDatabase, runSerializableTransaction } from "@/lib/server/database";
import { authorizeDocument } from "@/lib/server/document-authorization";
import type { DocumentActor } from "@/lib/server/document-service";
import { getObjectStorage } from "@/lib/server/r2-object-storage";

export type DocumentContentServiceErrorCode =
  | "DOCUMENT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "INVALID_UPLOAD"
  | "STORAGE_UNAVAILABLE"
  | "CONTENT_INTEGRITY_FAILED";

export class DocumentContentServiceError extends Error {
  constructor(
    readonly code: DocumentContentServiceErrorCode,
    readonly validationCode?: DocumentUploadValidationError["code"],
  ) {
    super(code);
    this.name = "DocumentContentServiceError";
  }
}

const versionSelect = {
  id: true,
  documentId: true,
  versionNumber: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  storageState: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DocumentVersionSelect;

type VersionRow = Prisma.DocumentVersionGetPayload<{ select: typeof versionSelect }>;

function serializeVersion(version: VersionRow) {
  return {
    ...version,
    sizeBytes: Number(version.sizeBytes),
    createdAt: version.createdAt.toISOString(),
  };
}

async function readVerifiedObjectBytes(
  body: ReadableStream<Uint8Array>,
  expectedSize: number,
) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > expectedSize) {
      await reader.cancel();
      throw new DocumentContentServiceError("CONTENT_INTEGRITY_FAILED");
    }
    chunks.push(value);
  }
  if (received !== expectedSize) {
    throw new DocumentContentServiceError("CONTENT_INTEGRITY_FAILED");
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function auditInTransaction(
  database: Prisma.TransactionClient,
  context: AuditRequestContext | undefined,
  input: Parameters<typeof appendAuditEventInTransaction>[1],
) {
  if (context) {
    await appendAuditEventInTransaction(database, { ...input, context });
  }
}

async function markVersionFailed(
  versionId: string,
  actor: DocumentActor,
  documentId: string,
  reason: string,
  database: PrismaClient,
  auditContext?: AuditRequestContext,
) {
  try {
    await runSerializableTransaction(database, async (transaction) => {
      await transaction.documentVersion.updateMany({
        where: { id: versionId, storageState: "PENDING" },
        data: { storageState: "FAILED" },
      });
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: "DOCUMENT_UPLOAD",
        outcome: "FAILED",
        resource: "DOCUMENT",
        targetId: versionId,
        reason,
      });
    });
  } catch {
    // Keep failure detectable even when audit signing is the failing dependency.
    await database.documentVersion.updateMany({
      where: { id: versionId, storageState: "PENDING" },
      data: { storageState: "FAILED" },
    });
  }
}

export async function createDocumentVersion(
  actor: DocumentActor,
  documentId: string,
  candidate: DocumentUploadCandidate,
  database: PrismaClient = getDatabase(),
  storage: ObjectStorage = getObjectStorage(),
  auditContext?: AuditRequestContext,
) {
  const prepared = await runSerializableTransaction(
    database,
    async (transaction) => {
      await transaction.$executeRaw`SELECT 1 FROM "Document" WHERE "id" = ${documentId} FOR UPDATE`;
      const authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "CREATE_VERSION",
        },
        transaction,
      );

      if (!authorization.document || !authorization.decision.allowed) {
        await auditInTransaction(transaction, auditContext, {
          actorId: actor.id,
          documentId: authorization.document?.id ?? null,
          action: "DOCUMENT_UPLOAD",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: authorization.decision.reason,
        });
        return { error: new DocumentContentServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      let upload;
      try {
        upload = validateDocumentUpload(candidate);
      } catch (error) {
        if (!(error instanceof DocumentUploadValidationError)) throw error;
        await auditInTransaction(transaction, auditContext, {
          actorId: actor.id,
          documentId,
          action: "DOCUMENT_UPLOAD",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: error.code,
          metadata: { receivedBytes: candidate.bytes.byteLength },
        });
        return {
          error: new DocumentContentServiceError("INVALID_UPLOAD", error.code),
        } as const;
      }

      const latest = await transaction.documentVersion.aggregate({
        where: { documentId },
        _max: { versionNumber: true },
      });
      const storageKey = createDocumentObjectKey();
      const version = await transaction.documentVersion.create({
        data: {
          documentId,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          originalFilename: upload.originalFilename,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          sha256: upload.sha256,
          storageKey,
          storageState: "PENDING",
          createdById: actor.id,
        },
        select: { ...versionSelect, storageKey: true },
      });
      return { value: { version, upload, authorization } } as const;
    },
  );

  if ("error" in prepared) throw prepared.error;
  const { version, upload, authorization } = prepared.value;

  try {
    await storage.put({
      key: parseObjectStorageKey(version.storageKey),
      body: upload.bytes,
      contentType: upload.mimeType,
      sha256: upload.sha256,
    });
  } catch {
    await markVersionFailed(
      version.id,
      actor,
      documentId,
      "STORAGE_WRITE_FAILED",
      database,
      auditContext,
    );
    throw new DocumentContentServiceError("STORAGE_UNAVAILABLE");
  }

  try {
    const ready = await runSerializableTransaction(database, async (transaction) => {
      const updated = await transaction.documentVersion.update({
        where: { id: version.id, storageState: "PENDING" },
        data: { storageState: "READY" },
        select: versionSelect,
      });
      const metadata = {
        versionId: version.id,
        versionNumber: version.versionNumber,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
      };
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: "DOCUMENT_UPLOAD",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: version.id,
        reason: authorization.decision.reason,
        metadata,
      });
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: "DOCUMENT_VERSION_CREATE",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: version.id,
        reason: authorization.decision.reason,
        metadata,
      });
      return updated;
    });
    return serializeVersion(ready);
  } catch (error) {
    let cleanupFailed = false;
    try {
      await storage.delete(parseObjectStorageKey(version.storageKey));
    } catch {
      cleanupFailed = true;
    }
    await markVersionFailed(
      version.id,
      actor,
      documentId,
      cleanupFailed ? "DATABASE_FINALIZE_AND_STORAGE_CLEANUP_FAILED" : "DATABASE_FINALIZE_FAILED",
      database,
      auditContext,
    );
    throw error;
  }
}

export async function listDocumentVersions(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(database, async (transaction) => {
    const authorization = await authorizeDocument(
      {
        actorId: actor.id,
        systemRole: actor.role,
        documentId,
        action: "VIEW_METADATA",
      },
      transaction,
    );
    if (!authorization.document || !authorization.decision.allowed) {
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId: authorization.document?.id ?? null,
        action: "DOCUMENT_READ",
        outcome: "DENIED",
        resource: "DOCUMENT",
        targetId: documentId,
        reason: authorization.decision.reason,
        metadata: { scope: "VERSION_HISTORY" },
      });
      return { error: new DocumentContentServiceError("DOCUMENT_NOT_FOUND") } as const;
    }
    const versions = await transaction.documentVersion.findMany({
      where: { documentId, storageState: "READY" },
      orderBy: { versionNumber: "desc" },
      select: versionSelect,
    });
    await auditInTransaction(transaction, auditContext, {
      actorId: actor.id,
      documentId,
      action: "DOCUMENT_READ",
      outcome: "ALLOWED",
      resource: "DOCUMENT",
      targetId: documentId,
      reason: authorization.decision.reason,
      metadata: { scope: "VERSION_HISTORY", returnedCount: versions.length },
    });
    return { value: versions.map(serializeVersion) } as const;
  });
  if ("error" in result) throw result.error;
  return result.value;
}

export async function getDocumentVersionContent(
  actor: DocumentActor,
  documentId: string,
  versionId: string,
  disposition: "inline" | "attachment",
  adminOverrideReason: string | null,
  database: PrismaClient = getDatabase(),
  storage: ObjectStorage = getObjectStorage(),
  auditContext?: AuditRequestContext,
) {
  const selected = await runSerializableTransaction(database, async (transaction) => {
    const action = disposition === "inline" ? "PREVIEW" : "DOWNLOAD";
    let authorization = await authorizeDocument(
      { actorId: actor.id, systemRole: actor.role, documentId, action },
      transaction,
    );
    let adminOverride = false;
    const adminOverrideAttempted = !authorization.decision.allowed && actor.role === "ADMIN";
    if (adminOverrideAttempted) {
      authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "ADMIN_OVERRIDE_READ",
          adminOverrideReason,
        },
        transaction,
      );
      adminOverride = authorization.decision.allowed;
    }
    const auditAction = adminOverrideAttempted
      ? "ADMIN_OVERRIDE_READ"
      : disposition === "inline"
        ? "DOCUMENT_READ"
        : "DOCUMENT_DOWNLOAD";
    if (!authorization.document || !authorization.decision.allowed) {
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId: authorization.document?.id ?? null,
        action: auditAction,
        outcome: "DENIED",
        resource: "DOCUMENT",
        targetId: versionId,
        reason: authorization.decision.reason,
        metadata: { disposition },
      });
      return { error: new DocumentContentServiceError("VERSION_NOT_FOUND") } as const;
    }
    const version = await transaction.documentVersion.findFirst({
      where: { id: versionId, documentId, storageState: "READY" },
      select: { ...versionSelect, storageKey: true },
    });
    if (!version) {
      await auditInTransaction(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: auditAction,
        outcome: "DENIED",
        resource: "DOCUMENT",
        targetId: versionId,
        reason: "VERSION_NOT_FOUND",
        metadata: { disposition },
      });
      return { error: new DocumentContentServiceError("VERSION_NOT_FOUND") } as const;
    }
    return {
      value: { version, authorization, auditAction, adminOverride },
    } as const;
  });
  if ("error" in selected) throw selected.error;

  const { version, authorization, auditAction, adminOverride } = selected.value;
  let object;
  try {
    object = await storage.get(parseObjectStorageKey(version.storageKey));
  } catch (error) {
    await appendAuditEvent({
      actorId: actor.id,
      documentId,
      action: auditAction,
      outcome: "FAILED",
      resource: "DOCUMENT",
      targetId: version.id,
      reason: error instanceof ObjectStorageError ? error.code : "STORAGE_READ_FAILED",
      context: auditContext,
      metadata: { disposition },
    }, database);
    throw new DocumentContentServiceError("STORAGE_UNAVAILABLE");
  }

  if (
    object.contentLength !== Number(version.sizeBytes) ||
    object.contentType !== version.mimeType ||
    object.sha256 !== version.sha256
  ) {
    await appendAuditEvent({
      actorId: actor.id,
      documentId,
      action: auditAction,
      outcome: "FAILED",
      resource: "DOCUMENT",
      targetId: version.id,
      reason: "CONTENT_INTEGRITY_FAILED",
      context: auditContext,
      metadata: { disposition },
    }, database);
    throw new DocumentContentServiceError("CONTENT_INTEGRITY_FAILED");
  }

  let verifiedBytes: Uint8Array;
  try {
    verifiedBytes = await readVerifiedObjectBytes(
      object.body,
      Number(version.sizeBytes),
    );
  } catch {
    await appendAuditEvent({
      actorId: actor.id,
      documentId,
      action: auditAction,
      outcome: "FAILED",
      resource: "DOCUMENT",
      targetId: version.id,
      reason: "CONTENT_INTEGRITY_FAILED",
      context: auditContext,
      metadata: { disposition },
    }, database);
    throw new DocumentContentServiceError("CONTENT_INTEGRITY_FAILED");
  }
  if (createHash("sha256").update(verifiedBytes).digest("hex") !== version.sha256) {
    await appendAuditEvent({
      actorId: actor.id,
      documentId,
      action: auditAction,
      outcome: "FAILED",
      resource: "DOCUMENT",
      targetId: version.id,
      reason: "CONTENT_INTEGRITY_FAILED",
      context: auditContext,
      metadata: { disposition },
    }, database);
    throw new DocumentContentServiceError("CONTENT_INTEGRITY_FAILED");
  }

  await appendAuditEvent({
    actorId: actor.id,
    documentId,
    action: auditAction,
    outcome: "ALLOWED",
    resource: "DOCUMENT",
    targetId: version.id,
    reason: authorization.decision.reason,
    context: auditContext,
    metadata: {
      disposition,
      versionNumber: version.versionNumber,
      sizeBytes: Number(version.sizeBytes),
      ...(adminOverride ? { overrideReason: adminOverrideReason } : {}),
    },
  }, database);

  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(verifiedBytes);
        controller.close();
      },
    }),
    filename: version.originalFilename,
    mimeType: version.mimeType,
    sizeBytes: Number(version.sizeBytes),
  };
}
