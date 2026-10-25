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

const grantUsageActions = [
  "DOCUMENT_METADATA_READ",
  "DOCUMENT_READ",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_UPDATE",
  "DOCUMENT_DELETE",
  "DOCUMENT_RESTORE",
  "DOCUMENT_UPLOAD",
  "DOCUMENT_VERSION_CREATE",
  "PERMISSION_LIST",
  "PERMISSION_GRANT",
  "PERMISSION_UPDATE",
  "PERMISSION_REVOKE",
  "ADMIN_OVERRIDE_READ",
] as const;

const allowedGrantUseActions = new Set<string>([
  "DOCUMENT_METADATA_READ",
  "DOCUMENT_READ",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_UPDATE",
  "DOCUMENT_VERSION_CREATE",
]);

type GrantUsageEvent = {
  actorId: string | null;
  documentId: string | null;
  action: (typeof grantUsageActions)[number];
  outcome: "ALLOWED" | "DENIED" | "FAILED";
  metadata: Prisma.JsonValue;
  occurredAt: Date;
};

export type GrantUsageSummary = {
  totalUses: number;
  metadataViews: number;
  versionHistoryViews: number;
  previews: number;
  downloads: number;
  metadataEdits: number;
  versionUploads: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  deniedAfterRevocationCount: number;
  latestDeniedAfterRevocationAt: string | null;
};

function metadataRecord(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

export function emptyGrantUsage(): GrantUsageSummary {
  return {
    totalUses: 0,
    metadataViews: 0,
    versionHistoryViews: 0,
    previews: 0,
    downloads: 0,
    metadataEdits: 0,
    versionUploads: 0,
    firstUsedAt: null,
    lastUsedAt: null,
    deniedAfterRevocationCount: 0,
    latestDeniedAfterRevocationAt: null,
  };
}

export async function grantUsageById(
  database: Pick<PrismaClient, "auditEvent">,
  grants: Array<{
    id: string;
    documentId: string;
    recipient: { id: string };
    createdAt: Date;
    revokedAt: Date | null;
  }>,
) {
  if (!grants.length) return new Map<string, GrantUsageSummary>();

  const events = await database.auditEvent.findMany({
    where: {
      documentId: { in: [...new Set(grants.map((grant) => grant.documentId))] },
      actorId: { in: [...new Set(grants.map((grant) => grant.recipient.id))] },
      action: { in: [...grantUsageActions] },
      occurredAt: {
        gte: new Date(Math.min(...grants.map((grant) => grant.createdAt.getTime()))),
      },
    },
    orderBy: { occurredAt: "asc" },
    select: {
      actorId: true,
      documentId: true,
      action: true,
      outcome: true,
      metadata: true,
      occurredAt: true,
    },
  }) as GrantUsageEvent[];

  const groupedGrants = new Map<string, typeof grants>();
  for (const grant of grants) {
    const key = `${grant.documentId}\0${grant.recipient.id}`;
    groupedGrants.set(key, [...(groupedGrants.get(key) ?? []), grant]);
  }

  const summaries = new Map<string, GrantUsageSummary>();
  for (const [key, recipientGrants] of groupedGrants) {
    recipientGrants.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const [documentId, recipientId] = key.split("\0");
    const matchingEvents = events.filter(
      (event) => event.documentId === documentId && event.actorId === recipientId,
    );

    recipientGrants.forEach((grant, index) => {
      const nextGrantAt = recipientGrants[index + 1]?.createdAt ?? null;
      const inLifecycle = matchingEvents.filter(
        (event) =>
          event.occurredAt >= grant.createdAt &&
          (!nextGrantAt || event.occurredAt < nextGrantAt),
      );
      const allowed = inLifecycle.filter(
        (event) =>
          event.outcome === "ALLOWED" &&
          allowedGrantUseActions.has(event.action) &&
          (!grant.revokedAt || event.occurredAt <= grant.revokedAt),
      );
      const deniedAfterRevocation = grant.revokedAt
        ? inLifecycle.filter(
            (event) => event.outcome === "DENIED" && event.occurredAt >= grant.revokedAt!,
          )
        : [];
      const summary = emptyGrantUsage();

      for (const event of allowed) {
        const metadata = metadataRecord(event.metadata);
        if (event.action === "DOCUMENT_METADATA_READ") summary.metadataViews += 1;
        if (event.action === "DOCUMENT_DOWNLOAD") summary.downloads += 1;
        if (event.action === "DOCUMENT_UPDATE") summary.metadataEdits += 1;
        if (event.action === "DOCUMENT_VERSION_CREATE") summary.versionUploads += 1;
        if (event.action === "DOCUMENT_READ" && metadata.disposition === "inline") {
          summary.previews += 1;
        } else if (
          event.action === "DOCUMENT_READ" &&
          metadata.scope === "VERSION_HISTORY"
        ) {
          summary.versionHistoryViews += 1;
        }
      }

      summary.totalUses = allowed.length;
      summary.firstUsedAt = allowed[0]?.occurredAt.toISOString() ?? null;
      summary.lastUsedAt = allowed.at(-1)?.occurredAt.toISOString() ?? null;
      summary.deniedAfterRevocationCount = deniedAfterRevocation.length;
      summary.latestDeniedAfterRevocationAt =
        deniedAfterRevocation.at(-1)?.occurredAt.toISOString() ?? null;
      summaries.set(grant.id, summary);
    });
  }

  return summaries;
}

function serializeGrant(grant: GrantRow, usage = emptyGrantUsage()) {
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
    usage,
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
      const usage = await grantUsageById(transaction, grants);

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

      return {
        value: {
          grants: grants.map((grant) => serializeGrant(grant, usage.get(grant.id))),
        },
      } as const;
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

