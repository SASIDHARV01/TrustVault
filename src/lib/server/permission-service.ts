import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  CreateGrantInput,
  UpdateGrantInput,
} from "@/lib/permission-api";
import {
  getDatabase,
  runSerializableTransaction,
} from "@/lib/server/database";
import { authorizeDocument } from "@/lib/server/document-authorization";
import type { DocumentActor } from "@/lib/server/document-service";
import {
  appendAuditEventInTransaction,
  type AuditRequestContext,
} from "@/lib/server/audit-service";

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

async function recordPermissionAudit(
  database: Prisma.TransactionClient,
  context: AuditRequestContext | undefined,
  input: Parameters<typeof appendAuditEventInTransaction>[1],
) {
  if (context) {
    await appendAuditEventInTransaction(database, { ...input, context });
  }
}

async function authorizeGrantOwner(
  database: Prisma.TransactionClient,
  actor: DocumentActor,
  documentId: string,
  action: "PERMISSION_LIST" | "PERMISSION_GRANT" | "PERMISSION_UPDATE" | "PERMISSION_REVOKE",
  auditContext: AuditRequestContext | undefined,
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
    await recordPermissionAudit(database, auditContext, {
      actorId: actor.id,
      documentId: authorization.document?.id ?? null,
      action,
      outcome: "DENIED",
      resource: "PERMISSION",
      targetId: documentId,
      reason: authorization.decision.reason,
    });
    return null;
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
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const document = await authorizeGrantOwner(
        transaction,
        actor,
        documentId,
        "PERMISSION_LIST",
        auditContext,
      );
      if (!document) {
        return { error: new PermissionServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      const grants = await transaction.documentGrant.findMany({
        where: { documentId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: grantSelect,
      });

      await recordPermissionAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: "PERMISSION_LIST",
        outcome: "ALLOWED",
        resource: "PERMISSION",
        targetId: documentId,
        reason: "ALLOW_OWNER",
        metadata: { resultCount: grants.length },
      });

      return { value: { grants: grants.map(serializeGrant) } } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.value;
}

export async function createDocumentGrant(
  actor: DocumentActor,
  documentId: string,
  input: CreateGrantInput,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  try {
    const result = await runSerializableTransaction(
      database,
      async (transaction) => {
        const document = await authorizeGrantOwner(
          transaction,
          actor,
          documentId,
          "PERMISSION_GRANT",
          auditContext,
        );
        if (!document) {
          return { error: new PermissionServiceError("DOCUMENT_NOT_FOUND") } as const;
        }
        const recipient = await findEligibleRecipient(
          transaction,
          actor.id,
          input.recipientEmail,
        );
        if (!recipient) {
          await recordPermissionAudit(transaction, auditContext, {
            actorId: actor.id,
            documentId,
            action: "PERMISSION_GRANT",
            outcome: "DENIED",
            resource: "PERMISSION",
            targetId: documentId,
            reason: "RECIPIENT_NOT_FOUND",
          });
          return { error: new PermissionServiceError("RECIPIENT_NOT_FOUND") } as const;
        }
        const existingGrant = await transaction.documentGrant.findFirst({
          where: { documentId, recipientId: recipient.id, revokedAt: null },
          select: { id: true },
        });

        if (existingGrant) {
          await recordPermissionAudit(transaction, auditContext, {
            actorId: actor.id,
            documentId,
            action: "PERMISSION_GRANT",
            outcome: "DENIED",
            resource: "PERMISSION",
            targetId: existingGrant.id,
            reason: "ACTIVE_GRANT_EXISTS",
            metadata: { recipientId: recipient.id },
          });
          return { error: new PermissionServiceError("ACTIVE_GRANT_EXISTS") } as const;
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

        await recordPermissionAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId,
          action: "PERMISSION_GRANT",
          outcome: "ALLOWED",
          resource: "PERMISSION",
          targetId: grant.id,
          reason: "ALLOW_OWNER",
          metadata: {
            recipientId: recipient.id,
            accessLevel: input.accessLevel,
          },
        });

        return { value: serializeGrant(grant) } as const;
      },
    );
    if ("error" in result) throw result.error;
    return result.value;
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
  auditContext?: AuditRequestContext,
) {
  try {
    const result = await runSerializableTransaction(
      database,
      async (transaction) => {
        const document = await authorizeGrantOwner(
          transaction,
          actor,
          documentId,
          "PERMISSION_UPDATE",
          auditContext,
        );
        if (!document) {
          return { error: new PermissionServiceError("DOCUMENT_NOT_FOUND") } as const;
        }
        const currentGrant = await transaction.documentGrant.findFirst({
          where: { id: grantId, documentId, revokedAt: null },
          select: { id: true, recipientId: true, accessLevel: true },
        });

        if (!currentGrant) {
          await recordPermissionAudit(transaction, auditContext, {
            actorId: actor.id,
            documentId,
            action: "PERMISSION_UPDATE",
            outcome: "DENIED",
            resource: "PERMISSION",
            targetId: grantId,
            reason: "GRANT_NOT_FOUND",
          });
          return { error: new PermissionServiceError("GRANT_NOT_FOUND") } as const;
        }
        if (currentGrant.accessLevel === input.accessLevel) {
          await recordPermissionAudit(transaction, auditContext, {
            actorId: actor.id,
            documentId,
            action: "PERMISSION_UPDATE",
            outcome: "DENIED",
            resource: "PERMISSION",
            targetId: grantId,
            reason: "GRANT_UNCHANGED",
          });
          return { error: new PermissionServiceError("GRANT_UNCHANGED") } as const;
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

        await recordPermissionAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId,
          action: "PERMISSION_UPDATE",
          outcome: "ALLOWED",
          resource: "PERMISSION",
          targetId: replacement.id,
          reason: "ALLOW_OWNER",
          metadata: {
            recipientId: currentGrant.recipientId,
            previousGrantId: currentGrant.id,
            previousAccessLevel: currentGrant.accessLevel,
            accessLevel: input.accessLevel,
          },
        });

        return { value: serializeGrant(replacement) } as const;
      },
    );
    if ("error" in result) throw result.error;
    return result.value;
  } catch (error) {
    return translateUniqueGrantError(error);
  }
}

export async function revokeDocumentGrant(
  actor: DocumentActor,
  documentId: string,
  grantId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const document = await authorizeGrantOwner(
        transaction,
        actor,
        documentId,
        "PERMISSION_REVOKE",
        auditContext,
      );
      if (!document) {
        return { error: new PermissionServiceError("DOCUMENT_NOT_FOUND") } as const;
      }
      const result = await transaction.documentGrant.updateMany({
        where: { id: grantId, documentId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });

      if (result.count !== 1) {
        await recordPermissionAudit(transaction, auditContext, {
          actorId: actor.id,
          documentId,
          action: "PERMISSION_REVOKE",
          outcome: "DENIED",
          resource: "PERMISSION",
          targetId: grantId,
          reason: "GRANT_NOT_FOUND",
        });
        return { error: new PermissionServiceError("GRANT_NOT_FOUND") } as const;
      }

      const grant = await transaction.documentGrant.findUnique({
        where: { id: grantId },
        select: grantSelect,
      });
      if (!grant) return { error: new PermissionServiceError("GRANT_NOT_FOUND") } as const;

      await recordPermissionAudit(transaction, auditContext, {
        actorId: actor.id,
        documentId,
        action: "PERMISSION_REVOKE",
        outcome: "ALLOWED",
        resource: "PERMISSION",
        targetId: grant.id,
        reason: "ALLOW_OWNER",
        metadata: {
          recipientId: grant.recipient.id,
          accessLevel: grant.accessLevel,
        },
      });

      return { value: serializeGrant(grant) } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.value;
}

