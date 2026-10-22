import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  CreateDocumentInput,
  DocumentListQuery,
  UpdateDocumentInput,
} from "@/lib/document-api";
import type { AuthorizationSystemRole } from "@/lib/document-authorization";
import {
  appendAuditEventInTransaction,
  type AuditRequestContext,
} from "@/lib/server/audit-service";
import {
  getDatabase,
  runSerializableTransaction,
} from "@/lib/server/database";
import { authorizeDocument } from "@/lib/server/document-authorization";

export type DocumentActor = {
  id: string;
  role: AuthorizationSystemRole;
};

export type DocumentServiceErrorCode = "DOCUMENT_NOT_FOUND" | "INVALID_CATEGORY";

export class DocumentServiceError extends Error {
  constructor(readonly code: DocumentServiceErrorCode) {
    super(code);
    this.name = "DocumentServiceError";
  }
}

async function recordDocumentAudit(
  database: Prisma.TransactionClient,
  context: AuditRequestContext | undefined,
  input: Parameters<typeof appendAuditEventInTransaction>[1],
) {
  if (context) {
    await appendAuditEventInTransaction(database, { ...input, context });
  }
}

const documentMetadataSelect = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  state: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect;

type DocumentMetadataRow = Prisma.DocumentGetPayload<{
  select: typeof documentMetadataSelect;
}>;

function serializeDocument(
  document: DocumentMetadataRow,
  access: "OWNER" | "READ" | "EDIT" | "ADMIN_METADATA",
) {
  return {
    id: document.id,
    name: document.name,
    description: document.description,
    state: document.state,
    access,
    owner: document.owner,
    category: document.category,
    deletedAt: document.deletedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

async function assertCategoryBelongsToOwner(
  database: Prisma.TransactionClient,
  categoryId: string | null | undefined,
  ownerId: string,
) {
  if (categoryId == null) return;

  const category = await database.category.findFirst({
    where: { id: categoryId, ownerId },
    select: { id: true },
  });

  if (!category) throw new DocumentServiceError("INVALID_CATEGORY");
}

function accessFor(
  actor: DocumentActor,
  ownerId: string,
  grant: "READ" | "EDIT" | undefined,
) {
  if (actor.id === ownerId) return "OWNER" as const;
  if (grant) return grant;
  return "ADMIN_METADATA" as const;
}

export async function listAccessibleDocuments(
  actor: DocumentActor,
  query: DocumentListQuery,
  database: PrismaClient = getDatabase(),
) {
  const accessFilter: Prisma.DocumentWhereInput =
    query.state === "DELETED"
      ? actor.role === "ADMIN"
        ? {}
        : { ownerId: actor.id }
      : actor.role === "ADMIN"
        ? {}
        : {
            OR: [
              { ownerId: actor.id },
              {
                grants: {
                  some: { recipientId: actor.id, revokedAt: null },
                },
              },
            ],
          };

  const requestedFilters: Prisma.DocumentWhereInput = {
    ...(query.q
      ? { name: { contains: query.q, mode: "insensitive" as const } }
      : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.owner
      ? {
          owner: {
            OR: [
              { name: { contains: query.owner, mode: "insensitive" as const } },
              { email: { contains: query.owner, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.category
      ? {
          category: {
            name: { contains: query.category, mode: "insensitive" as const },
          },
        }
      : {}),
    ...(query.createdFrom || query.createdTo
      ? {
          createdAt: {
            ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
            ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
          },
        }
      : {}),
  };
  const where: Prisma.DocumentWhereInput = {
    AND: [{ state: query.state }, accessFilter, requestedFilters],
  };
  const skip = (query.page - 1) * query.limit;
  const orderBy = [
    { [query.sort]: query.order },
    { id: query.order },
  ] satisfies Prisma.DocumentOrderByWithRelationInput[];

  return database.$transaction(
    async (transaction) => {
      const rows = await transaction.document.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        select: {
          ...documentMetadataSelect,
          grants: {
            where: { recipientId: actor.id, revokedAt: null },
            select: { accessLevel: true },
            take: 1,
          },
        },
      });
      const total = await transaction.document.count({ where });

      return {
        documents: rows.map((document) =>
          serializeDocument(
            document,
            accessFor(actor, document.ownerId, document.grants[0]?.accessLevel),
          ),
        ),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function createDocumentMetadata(
  actor: DocumentActor,
  input: CreateDocumentInput,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  return runSerializableTransaction(
    database,
    async (transaction) => {
      await assertCategoryBelongsToOwner(transaction, input.categoryId, actor.id);

      const document = await transaction.document.create({
        data: {
          ownerId: actor.id,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
        },
        select: documentMetadataSelect,
      });

      await recordDocumentAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId: document.id,
        action: "DOCUMENT_CREATE",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: document.id,
        reason: "ALLOW_OWNER",
        metadata: { fields: ["name", "description", "categoryId"] },
      });

      return serializeDocument(document, "OWNER");
    },
  );
}

export async function getDocumentMetadata(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
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
        await recordDocumentAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId: authorization.document?.id ?? null,
          action: "DOCUMENT_METADATA_READ",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: authorization.decision.reason,
        });
        return { error: new DocumentServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      const document = await transaction.document.findUnique({
        where: { id: documentId },
        select: {
          ...documentMetadataSelect,
          grants: {
            where: { recipientId: actor.id, revokedAt: null },
            select: { accessLevel: true },
            take: 1,
          },
        },
      });

      if (!document) return { error: new DocumentServiceError("DOCUMENT_NOT_FOUND") } as const;

      await recordDocumentAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId: document.id,
        action: "DOCUMENT_METADATA_READ",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: document.id,
        reason: authorization.decision.reason,
      });

      return {
        document: serializeDocument(
          document,
          accessFor(actor, document.ownerId, document.grants[0]?.accessLevel),
        ),
      } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.document;
}

export async function updateDocumentMetadata(
  actor: DocumentActor,
  documentId: string,
  input: UpdateDocumentInput,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "UPDATE_METADATA",
        },
        transaction,
      );

      if (!authorization.document || !authorization.decision.allowed) {
        await recordDocumentAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId: authorization.document?.id ?? null,
          action: "DOCUMENT_UPDATE",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: authorization.decision.reason,
        });
        return { error: new DocumentServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      await assertCategoryBelongsToOwner(
        transaction,
        input.categoryId,
        authorization.document.ownerId,
      );

      const document = await transaction.document.update({
        where: { id: documentId },
        data: input,
        select: documentMetadataSelect,
      });

      await recordDocumentAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId: document.id,
        action: "DOCUMENT_UPDATE",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: document.id,
        reason: authorization.decision.reason,
        metadata: { fields: Object.keys(input).sort() },
      });

      return {
        document: serializeDocument(
          document,
          accessFor(
            actor,
            document.ownerId,
            authorization.decision.reason === "ALLOW_EDIT_GRANT"
              ? "EDIT"
              : undefined,
          ),
        ),
      } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.document;
}

export async function deleteDocument(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "DELETE",
        },
        transaction,
      );

      if (!authorization.document || !authorization.decision.allowed) {
        await recordDocumentAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId: authorization.document?.id ?? null,
          action: "DOCUMENT_DELETE",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: authorization.decision.reason,
        });
        return { error: new DocumentServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      const document = await transaction.document.update({
        where: { id: documentId },
        data: {
          state: "DELETED",
          deletedAt: new Date(),
          deletedById: actor.id,
        },
        select: documentMetadataSelect,
      });

      await recordDocumentAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId: document.id,
        action: "DOCUMENT_DELETE",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: document.id,
        reason: authorization.decision.reason,
      });

      return { document: serializeDocument(document, "OWNER") } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.document;
}

export async function restoreDocument(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "RESTORE",
        },
        transaction,
      );

      if (!authorization.document || !authorization.decision.allowed) {
        await recordDocumentAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId: authorization.document?.id ?? null,
          action: "DOCUMENT_RESTORE",
          outcome: "DENIED",
          resource: "DOCUMENT",
          targetId: documentId,
          reason: authorization.decision.reason,
        });
        return { error: new DocumentServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      const document = await transaction.document.update({
        where: { id: documentId },
        data: { state: "ACTIVE", deletedAt: null, deletedById: null },
        select: documentMetadataSelect,
      });

      await recordDocumentAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId: document.id,
        action: "DOCUMENT_RESTORE",
        outcome: "ALLOWED",
        resource: "DOCUMENT",
        targetId: document.id,
        reason: authorization.decision.reason,
      });

      return { document: serializeDocument(document, "OWNER") } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.document;
}

