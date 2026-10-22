import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  createAuditCheckpointObjectKey,
  parseObjectStorageKey,
  type ObjectStorage,
} from "@/lib/object-storage";
import {
  appendAuditEvent,
  appendAuditEventInTransaction,
  type AuditRequestContext,
  verifyStoredAuditChain,
} from "@/lib/server/audit-service";
import { getDatabase, runSerializableTransaction } from "@/lib/server/database";
import type { DocumentActor } from "@/lib/server/document-service";
import { getObjectStorage } from "@/lib/server/r2-object-storage";

export class AuditCheckpointServiceError extends Error {
  constructor(
    readonly code: "ADMIN_REQUIRED" | "CHAIN_INVALID" | "NO_AUDIT_EVENTS" | "STORAGE_UNAVAILABLE",
  ) {
    super(code);
    this.name = "AuditCheckpointServiceError";
  }
}

function serializeCheckpoint(checkpoint: {
  id: string;
  throughEventId: bigint;
  chainHash: string;
  createdAt: Date;
}) {
  return {
    id: checkpoint.id,
    throughEventId: checkpoint.throughEventId.toString(),
    chainHash: checkpoint.chainHash,
    createdAt: checkpoint.createdAt.toISOString(),
  };
}

async function assertAdmin(
  actor: DocumentActor,
  database: PrismaClient,
  context?: AuditRequestContext,
) {
  if (actor.role === "ADMIN") return;
  await appendAuditEvent({
    actorId: actor.id,
    action: "AUDIT_CHECKPOINT_CREATE",
    outcome: "DENIED",
    resource: "AUDIT",
    targetId: "SYSTEM",
    reason: "DENY_ADMIN_REQUIRED",
    context,
  }, database);
  throw new AuditCheckpointServiceError("ADMIN_REQUIRED");
}

export async function listAuditCheckpoints(
  actor: DocumentActor,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  await assertAdmin(actor, database, auditContext);
  return runSerializableTransaction(database, async (transaction) => {
    const checkpoints = await transaction.auditCheckpoint.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        throughEventId: true,
        chainHash: true,
        createdAt: true,
      },
    });
    if (auditContext) {
      await appendAuditEventInTransaction(transaction, {
        actorId: actor.id,
        action: "AUDIT_VIEW",
        outcome: "ALLOWED",
        resource: "AUDIT",
        targetId: "CHECKPOINTS",
        reason: "ALLOW_ADMIN_ACTIVITY",
        context: auditContext,
        metadata: { scope: "AUDIT_CHECKPOINTS", returnedCount: checkpoints.length },
      });
    }
    return checkpoints.map(serializeCheckpoint);
  });
}

export async function createAuditCheckpoint(
  actor: DocumentActor,
  database: PrismaClient = getDatabase(),
  storage: ObjectStorage = getObjectStorage(),
  auditContext?: AuditRequestContext,
) {
  await assertAdmin(actor, database, auditContext);
  const verification = await verifyStoredAuditChain(database);
  if (!verification.valid) {
    await appendAuditEvent({
      actorId: actor.id,
      action: "AUDIT_CHECKPOINT_CREATE",
      outcome: "FAILED",
      resource: "AUDIT",
      targetId: "SYSTEM",
      reason: "CHAIN_INVALID",
      context: auditContext,
      metadata: {
        invalidEventId: verification.invalidEventId,
        verificationReason: verification.reason,
      },
    }, database);
    throw new AuditCheckpointServiceError("CHAIN_INVALID");
  }
  if (verification.eventCount < 1 || verification.headHash === null) {
    throw new AuditCheckpointServiceError("NO_AUDIT_EVENTS");
  }

  const throughEvent = await database.auditEvent.findUnique({
    where: { eventHash: verification.headHash },
    select: { id: true, eventId: true, occurredAt: true },
  });
  if (!throughEvent) throw new AuditCheckpointServiceError("CHAIN_INVALID");

  const existing = await database.auditCheckpoint.findUnique({
    where: { throughEventId: throughEvent.id },
    select: { id: true, throughEventId: true, chainHash: true, createdAt: true },
  });
  if (existing) return serializeCheckpoint(existing);

  const createdAt = new Date();
  const payload = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    createdAt: createdAt.toISOString(),
    throughEventId: throughEvent.id.toString(),
    throughEventPublicId: throughEvent.eventId,
    throughEventOccurredAt: throughEvent.occurredAt.toISOString(),
    eventCount: verification.eventCount,
    chainHash: verification.headHash,
  }));
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const storageKey = createAuditCheckpointObjectKey();

  try {
    await storage.put({
      key: storageKey,
      body: payload,
      contentType: "application/json",
      sha256,
    });
  } catch {
    await appendAuditEvent({
      actorId: actor.id,
      action: "AUDIT_CHECKPOINT_CREATE",
      outcome: "FAILED",
      resource: "AUDIT",
      targetId: throughEvent.eventId,
      reason: "STORAGE_WRITE_FAILED",
      context: auditContext,
    }, database);
    throw new AuditCheckpointServiceError("STORAGE_UNAVAILABLE");
  }

  try {
    const checkpoint = await runSerializableTransaction(database, async (transaction) => {
      const created = await transaction.auditCheckpoint.create({
        data: {
          throughEventId: throughEvent.id,
          chainHash: verification.headHash,
          storageKey,
          createdAt,
        },
        select: { id: true, throughEventId: true, chainHash: true, createdAt: true },
      });
      if (auditContext) {
        await appendAuditEventInTransaction(transaction, {
          actorId: actor.id,
          action: "AUDIT_CHECKPOINT_CREATE",
          outcome: "ALLOWED",
          resource: "AUDIT",
          targetId: created.id,
          reason: "CHAIN_HEAD_CHECKPOINTED",
          context: auditContext,
          metadata: {
            throughEventId: throughEvent.id.toString(),
            eventCount: verification.eventCount,
            chainHash: verification.headHash,
            checkpointSha256: sha256,
          },
        });
      }
      return created;
    });
    return serializeCheckpoint(checkpoint);
  } catch (error) {
    try {
      await storage.delete(parseObjectStorageKey(storageKey));
    } catch {
      // The unreferenced unique key remains detectable by bucket inventory tooling.
    }
    throw error;
  }
}
