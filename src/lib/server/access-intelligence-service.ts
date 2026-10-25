import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AccessIntelligenceQuery } from "@/lib/access-intelligence-api";
import type { AuditKeyring } from "@/lib/server/audit-config";
import { getAuditKeyring } from "@/lib/server/audit-config";
import {
  appendAuditEventInTransaction,
  type AuditRequestContext,
} from "@/lib/server/audit-service";
import { getDatabase, runSerializableTransaction } from "@/lib/server/database";
import {
  emptyGrantUsage,
  grantUsageById,
} from "@/lib/server/permission-service";
import type { DocumentActor } from "@/lib/server/document-service";

export class AccessIntelligenceServiceError extends Error {
  constructor(readonly code: "ADMIN_REQUIRED") {
    super(code);
    this.name = "AccessIntelligenceServiceError";
  }
}

const intelligenceGrantSelect = {
  id: true,
  documentId: true,
  accessLevel: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  recipient: { select: { id: true, name: true, email: true } },
  grantedBy: { select: { id: true, name: true, email: true } },
  revokedBy: { select: { id: true, name: true, email: true } },
  document: {
    select: {
      id: true,
      name: true,
      state: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.DocumentGrantSelect;

type IntelligenceGrant = Prisma.DocumentGrantGetPayload<{
  select: typeof intelligenceGrantSelect;
}>;

function serializeGrant(
  grant: IntelligenceGrant,
  usage = emptyGrantUsage(),
) {
  return {
    id: grant.id,
    documentId: grant.documentId,
    accessLevel: grant.accessLevel,
    status: grant.revokedAt ? ("REVOKED" as const) : ("ACTIVE" as const),
    document: grant.document,
    recipient: grant.recipient,
    grantedBy: grant.grantedBy,
    revokedBy: grant.revokedBy,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    usage,
  };
}

export async function listSystemAccessIntelligence(
  actor: DocumentActor,
  query: AccessIntelligenceQuery,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
  keyring: AuditKeyring = getAuditKeyring(),
) {
  const result = await runSerializableTransaction(database, async (transaction) => {
    if (actor.role !== "ADMIN") {
      if (auditContext) {
        await appendAuditEventInTransaction(
          transaction,
          {
            actorId: actor.id,
            action: "AUDIT_VIEW",
            outcome: "DENIED",
            resource: "PERMISSION",
            targetId: "ACCESS_INTELLIGENCE",
            reason: "DENY_ADMIN_REQUIRED",
            context: auditContext,
          },
          keyring,
        );
      }
      return {
        error: new AccessIntelligenceServiceError("ADMIN_REQUIRED"),
      } as const;
    }

    const where: Prisma.DocumentGrantWhereInput = {
      ...(query.status === "ACTIVE" ? { revokedAt: null } : {}),
      ...(query.status === "REVOKED" ? { revokedAt: { not: null } } : {}),
      ...(query.accessLevel ? { accessLevel: query.accessLevel } : {}),
      ...(query.q
        ? {
            OR: [
              { document: { name: { contains: query.q, mode: "insensitive" } } },
              { document: { owner: { name: { contains: query.q, mode: "insensitive" } } } },
              { document: { owner: { email: { contains: query.q, mode: "insensitive" } } } },
              { recipient: { name: { contains: query.q, mode: "insensitive" } } },
              { recipient: { email: { contains: query.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [grants, total] = await Promise.all([
      transaction.documentGrant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: intelligenceGrantSelect,
      }),
      transaction.documentGrant.count({ where }),
    ]);
    const usage = await grantUsageById(transaction, grants);

    if (auditContext) {
      await appendAuditEventInTransaction(
        transaction,
        {
          actorId: actor.id,
          action: "AUDIT_VIEW",
          outcome: "ALLOWED",
          resource: "PERMISSION",
          targetId: "ACCESS_INTELLIGENCE",
          reason: "ALLOW_ADMIN_ACTIVITY",
          context: auditContext,
          metadata: { scope: "ACCESS_INTELLIGENCE", resultCount: grants.length },
        },
        keyring,
      );
    }

    return {
      value: {
        grants: grants.map((grant) => serializeGrant(grant, usage.get(grant.id))),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      },
    } as const;
  });

  if ("error" in result) throw result.error;
  return result.value;
}
