import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  CreateGrantInput,
  UpdateGrantInput,
} from "@/lib/permission-api";
import { getDatabase } from "@/lib/server/database";
import { authorizeDocument } from "@/lib/server/document-authorization";
import type { DocumentActor } from "@/lib/server/document-service";

export type PermissionServiceErrorCode =
  | "DOCUMENT_NOT_FOUND"
  | "RECIPIENT_NOT_FOUND"
  | "ACTIVE_GRANT_EXISTS"
  | "GRANT_NOT_FOUND"
  | "GRANT_UNCHANGED";

export class PermissionServiceError extends Error {
  constructor(readonly code: PermissionServiceErrorCode) {
    super(code);
    this.name = "PermissionServiceError";
  }
}

const grantSelect = {
  id: true,
  documentId: true,
  accessLevel: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  recipient: { select: { id: true, name: true, email: true } },
  grantedBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} satisfies Prisma.DocumentGrantSelect;

type GrantRow = Prisma.DocumentGrantGetPayload<{ select: typeof grantSelect }>;

function serializeGrant(grant: GrantRow) {
  return {
    id: grant.id,
    documentId: grant.documentId,
    accessLevel: grant.accessLevel,
    status: grant.revokedAt ? ("REVOKED" as const) : ("ACTIVE" as const),
    recipient: grant.recipient,
    grantedBy: grant.grantedBy,
    revokedBy: grant.revokedBy,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

async function requireGrantOwner(
  database: Prisma.TransactionClient,
  actor: DocumentActor,
  documentId: string,
) {
  const authorization = await authorizeDocument(
    {
      actorId: actor.id,
      systemRole: actor.role,
      documentId,
      action: "MANAGE_GRANTS",
    },
    database,
  );

  if (!authorization.document || !authorization.decision.allowed) {
    throw new PermissionServiceError("DOCUMENT_NOT_FOUND");
  }

  return authorization.document;
}

async function findEligibleRecipient(
  database: Prisma.TransactionClient,
  actorId: string,
  email: string,
) {
  const recipient = await database.user.findFirst({
    where: {
      email,
      disabledAt: null,
      id: { not: actorId },
    },
    select: { id: true, name: true, email: true },
  });

  if (!recipient) throw new PermissionServiceError("RECIPIENT_NOT_FOUND");
  return recipient;
}

function translateUniqueGrantError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new PermissionServiceError("ACTIVE_GRANT_EXISTS");
  }
  throw error;
}

export async function lookupEligibleRecipient(
  actor: DocumentActor,
  email: string,
  database: PrismaClient = getDatabase(),
) {
  const recipient = await database.user.findFirst({
    where: {
      email,
      disabledAt: null,
      id: { not: actor.id },
    },
    select: { id: true, name: true, email: true },
  });

  if (!recipient) throw new PermissionServiceError("RECIPIENT_NOT_FOUND");
  return recipient;
}

export async function listDocumentGrants(
  actor: DocumentActor,
  documentId: string,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
    async (transaction) => {
      await requireGrantOwner(transaction, actor, documentId);

      const grants = await transaction.documentGrant.findMany({
        where: { documentId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: grantSelect,
      });

      return { grants: grants.map(serializeGrant) };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function createDocumentGrant(
  actor: DocumentActor,
  documentId: string,
  input: CreateGrantInput,
  database: PrismaClient = getDatabase(),
) {
  try {
    return await database.$transaction(
      async (transaction) => {
        await requireGrantOwner(transaction, actor, documentId);
        const recipient = await findEligibleRecipient(
          transaction,
          actor.id,
          input.recipientEmail,
        );
        const existingGrant = await transaction.documentGrant.findFirst({
          where: { documentId, recipientId: recipient.id, revokedAt: null },
          select: { id: true },
        });

        if (existingGrant) {
          throw new PermissionServiceError("ACTIVE_GRANT_EXISTS");
        }

        const grant = await transaction.documentGrant.create({
          data: {
            documentId,
            recipientId: recipient.id,
            accessLevel: input.accessLevel,
            grantedById: actor.id,
          },
          select: grantSelect,
        });

        return serializeGrant(grant);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return translateUniqueGrantError(error);
  }
}

export async function updateDocumentGrant(
  actor: DocumentActor,
  documentId: string,
  grantId: string,
  input: UpdateGrantInput,
  database: PrismaClient = getDatabase(),
) {
  try {
    return await database.$transaction(
      async (transaction) => {
        await requireGrantOwner(transaction, actor, documentId);
        const currentGrant = await transaction.documentGrant.findFirst({
          where: { id: grantId, documentId, revokedAt: null },
          select: { id: true, recipientId: true, accessLevel: true },
        });

        if (!currentGrant) throw new PermissionServiceError("GRANT_NOT_FOUND");
        if (currentGrant.accessLevel === input.accessLevel) {
          throw new PermissionServiceError("GRANT_UNCHANGED");
        }

        const revokedAt = new Date();
        await transaction.documentGrant.update({
          where: { id: currentGrant.id },
          data: { revokedAt, revokedById: actor.id },
        });
        const replacement = await transaction.documentGrant.create({
          data: {
            documentId,
            recipientId: currentGrant.recipientId,
            accessLevel: input.accessLevel,
            grantedById: actor.id,
          },
          select: grantSelect,
        });

        return serializeGrant(replacement);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return translateUniqueGrantError(error);
  }
}

export async function revokeDocumentGrant(
  actor: DocumentActor,
  documentId: string,
  grantId: string,
  database: PrismaClient = getDatabase(),
) {
  return database.$transaction(
    async (transaction) => {
      await requireGrantOwner(transaction, actor, documentId);
      const result = await transaction.documentGrant.updateMany({
        where: { id: grantId, documentId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });

      if (result.count !== 1) throw new PermissionServiceError("GRANT_NOT_FOUND");

      const grant = await transaction.documentGrant.findUnique({
        where: { id: grantId },
        select: grantSelect,
      });
      if (!grant) throw new PermissionServiceError("GRANT_NOT_FOUND");

      return serializeGrant(grant);
    },
    { isolationLevel: "Serializable" },
  );
}

