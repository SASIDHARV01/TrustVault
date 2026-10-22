import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  CreateDocumentInput,
  DocumentListQuery,
  UpdateDocumentInput,
} from "@/lib/document-api";
import type { AuthorizationSystemRole } from "@/lib/document-authorization";
import { getDatabase } from "@/lib/server/database";
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

  const where: Prisma.DocumentWhereInput = {
    state: query.state,
    ...accessFilter,
    ...(query.q
      ? { name: { contains: query.q, mode: "insensitive" as const } }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  return database.$transaction(
    async (transaction) => {
      const rows = await transaction.document.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
) {
  return database.$transaction(
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

      return serializeDocument(document, "OWNER");
    },
    { isolationLevel: "Serializable" },
  );
}

export async function getDocumentMetadata(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
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
        throw new DocumentServiceError("DOCUMENT_NOT_FOUND");
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

      if (!document) throw new DocumentServiceError("DOCUMENT_NOT_FOUND");

      return serializeDocument(
        document,
        accessFor(actor, document.ownerId, document.grants[0]?.accessLevel),
      );
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function updateDocumentMetadata(
  actor: DocumentActor,
  documentId: string,
  input: UpdateDocumentInput,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
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
        throw new DocumentServiceError("DOCUMENT_NOT_FOUND");
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

      return serializeDocument(
        document,
        accessFor(
          actor,
          document.ownerId,
          authorization.decision.reason === "ALLOW_EDIT_GRANT" ? "EDIT" : undefined,
        ),
      );
    },
    { isolationLevel: "Serializable" },
  );
}

export async function deleteDocument(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
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
        throw new DocumentServiceError("DOCUMENT_NOT_FOUND");
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

      return serializeDocument(document, "OWNER");
    },
    { isolationLevel: "Serializable" },
  );
}

export async function restoreDocument(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
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
        throw new DocumentServiceError("DOCUMENT_NOT_FOUND");
      }

      const document = await transaction.document.update({
        where: { id: documentId },
        data: { state: "ACTIVE", deletedAt: null, deletedById: null },
        select: documentMetadataSelect,
      });

      return serializeDocument(document, "OWNER");
    },
    { isolationLevel: "Serializable" },
  );
}

