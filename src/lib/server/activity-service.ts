import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  AdminActivityQuery,
  DocumentActivityQuery,
} from "@/lib/audit-api";
import type { AuditVerificationResult } from "@/lib/audit-chain";
import type { AuditKeyring } from "@/lib/server/audit-config";
import { getAuditKeyring } from "@/lib/server/audit-config";
import {
  appendAuditEvent,
  appendAuditEventInTransaction,
  type AuditRequestContext,
  verifyStoredAuditChain,
} from "@/lib/server/audit-service";
import {
  getDatabase,
  runSerializableTransaction,
} from "@/lib/server/database";
import { authorizeDocument } from "@/lib/server/document-authorization";
import type { DocumentActor } from "@/lib/server/document-service";

export class ActivityServiceError extends Error {
  constructor(readonly code: "DOCUMENT_NOT_FOUND" | "ADMIN_REQUIRED") {
    super(code);
    this.name = "ActivityServiceError";
  }
}

const activitySelect = {
  eventId: true,
  action: true,
  outcome: true,
  resource: true,
  targetId: true,
  reason: true,
  requestId: true,
  metadata: true,
  occurredAt: true,
  actor: { select: { id: true, name: true, email: true } },
  document: { select: { id: true, name: true } },
} satisfies Prisma.AuditEventSelect;

function serializeActivity(
  event: Prisma.AuditEventGetPayload<{ select: typeof activitySelect }>,
) {
  return {
    ...event,
    occurredAt: event.occurredAt.toISOString(),
  };
}

function timeFilter(from?: string, to?: string) {
  return from || to
    ? {
        occurredAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        },
      }
    : {};
}

function pagination(query: { page: number; limit: number }, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function listDocumentActivity(
  actor: DocumentActor,
  documentId: string,
  query: DocumentActivityQuery,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
  keyring: AuditKeyring = getAuditKeyring(),
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      const authorization = await authorizeDocument(
        {
          actorId: actor.id,
          systemRole: actor.role,
          documentId,
          action: "VIEW_ACTIVITY",
        },
        transaction,
      );

      if (!authorization.document || !authorization.decision.allowed) {
        if (auditContext) {
          await appendAuditEventInTransaction(
            transaction,
            {
              actorId: actor.id,
              documentId: authorization.document?.id ?? null,
              action: "AUDIT_VIEW",
              outcome: "DENIED",
              resource: "AUDIT",
              targetId: documentId,
              reason: authorization.decision.reason,
              context: auditContext,
            },
            keyring,
          );
        }
        return { error: new ActivityServiceError("DOCUMENT_NOT_FOUND") } as const;
      }

      const where: Prisma.AuditEventWhereInput = {
        documentId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...timeFilter(query.from, query.to),
      };
      const events = await transaction.auditEvent.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: activitySelect,
      });
      const total = await transaction.auditEvent.count({ where });

      if (auditContext) {
        await appendAuditEventInTransaction(
          transaction,
          {
            actorId: actor.id,
            documentId,
            action: "AUDIT_VIEW",
            outcome: "ALLOWED",
            resource: "AUDIT",
            targetId: documentId,
            reason: authorization.decision.reason,
            context: auditContext,
            metadata: { scope: "DOCUMENT" },
          },
          keyring,
        );
      }

      return {
        value: {
          events: events.map(serializeActivity),
          pagination: pagination(query, total),
        },
      } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.value;
}

export async function listSystemActivity(
  actor: DocumentActor,
  query: AdminActivityQuery,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
  keyring: AuditKeyring = getAuditKeyring(),
) {
  const result = await runSerializableTransaction(
    database,
    async (transaction) => {
      if (actor.role !== "ADMIN") {
        if (auditContext) {
          await appendAuditEventInTransaction(
            transaction,
            {
              actorId: actor.id,
              action: "AUDIT_VIEW",
              outcome: "DENIED",
              resource: "AUDIT",
              targetId: "SYSTEM",
              reason: "DENY_ADMIN_REQUIRED",
              context: auditContext,
            },
            keyring,
          );
        }
        return { error: new ActivityServiceError("ADMIN_REQUIRED") } as const;
      }

      const where: Prisma.AuditEventWhereInput = {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.documentId ? { documentId: query.documentId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...timeFilter(query.from, query.to),
      };
      const events = await transaction.auditEvent.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: activitySelect,
      });
      const total = await transaction.auditEvent.count({ where });

      if (auditContext) {
        await appendAuditEventInTransaction(
          transaction,
          {
            actorId: actor.id,
            action: "AUDIT_VIEW",
            outcome: "ALLOWED",
            resource: "AUDIT",
            targetId: "SYSTEM",
            reason: "ALLOW_ADMIN_ACTIVITY",
            context: auditContext,
            metadata: { scope: "SYSTEM" },
          },
          keyring,
        );
      }

      return {
        value: {
          events: events.map(serializeActivity),
          pagination: pagination(query, total),
        },
      } as const;
    },
  );

  if ("error" in result) throw result.error;
  return result.value;
}

export async function verifySystemAudit(
  actor: DocumentActor,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
  keyring: AuditKeyring = getAuditKeyring(),
): Promise<AuditVerificationResult> {
  if (actor.role !== "ADMIN") {
    await appendAuditEvent(
      {
        actorId: actor.id,
        action: "AUDIT_VERIFY",
        outcome: "DENIED",
        resource: "AUDIT",
        targetId: "SYSTEM",
        reason: "DENY_ADMIN_REQUIRED",
        context: auditContext,
      },
      database,
      keyring,
    );
    throw new ActivityServiceError("ADMIN_REQUIRED");
  }

  const verification = await verifyStoredAuditChain(database, keyring);
  if (verification.valid) {
    await appendAuditEvent(
      {
        actorId: actor.id,
        action: "AUDIT_VERIFY",
        outcome: "ALLOWED",
        resource: "AUDIT",
        targetId: "SYSTEM",
        reason: "CHAIN_VALID",
        context: auditContext,
        metadata: {
          verifiedEventCount: verification.eventCount,
          verifiedHeadHash: verification.headHash,
        },
      },
      database,
      keyring,
    );
  }

  return verification;
}

