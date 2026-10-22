import "server-only";

import { randomUUID } from "node:crypto";

import {
  type AuditAction,
  type AuditOutcome,
  type AuditResource,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  AUDIT_GENESIS_HASH,
  computeAuditEventHash,
  type AuditHashPayload,
  type AuditJson,
  verifyAuditChain,
} from "@/lib/audit-chain";
import { getAuditKeyring, type AuditKeyring } from "@/lib/server/audit-config";
import {
  getDatabase,
  runSerializableTransaction,
} from "@/lib/server/database";

const auditAdvisoryLockId = 1_414_947_921;

export type AuditRequestContext = {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AppendAuditEventInput = {
  actorId?: string | null;
  documentId?: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  resource: AuditResource;
  targetId?: string | null;
  reason?: string | null;
  context?: AuditRequestContext | null;
  metadata?: AuditJson;
  occurredAt?: Date;
};

function requiredKey(keyring: AuditKeyring, version: number) {
  const key = keyring.keyForVersion(version);
  if (!key) throw new Error(`Audit HMAC key version ${version} is unavailable.`);
  return key;
}

function validateText(value: string | null | undefined, maximum: number, field: string) {
  if (value && value.length > maximum) {
    throw new Error(`${field} exceeds the audit storage limit.`);
  }
}

export async function appendAuditEventInTransaction(
  database: Prisma.TransactionClient,
  input: AppendAuditEventInput,
  keyring: AuditKeyring = getAuditKeyring(),
) {
  validateText(input.targetId, 255, "targetId");
  validateText(input.reason, 1000, "reason");
  validateText(input.context?.requestId, 128, "requestId");
  validateText(input.context?.ipAddress, 45, "ipAddress");
  validateText(input.context?.userAgent, 512, "userAgent");

  await database.$executeRaw`SELECT pg_advisory_xact_lock(${auditAdvisoryLockId})`;
  const previous = await database.auditEvent.findFirst({
    orderBy: { id: "desc" },
    select: { eventHash: true },
  });
  const eventId = randomUUID();
  const occurredAt = input.occurredAt ?? new Date();
  const previousHash = previous?.eventHash ?? AUDIT_GENESIS_HASH;
  const hmacKeyVersion = keyring.currentVersion;
  const metadata = input.metadata ?? {};
  const payload: AuditHashPayload = {
    eventId,
    actorId: input.actorId ?? null,
    documentId: input.documentId ?? null,
    action: input.action,
    outcome: input.outcome,
    resource: input.resource,
    targetId: input.targetId ?? null,
    reason: input.reason ?? null,
    requestId: input.context?.requestId ?? null,
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
    metadata,
    previousHash,
    hmacKeyVersion,
    occurredAt: occurredAt.toISOString(),
  };
  const eventHash = computeAuditEventHash(
    payload,
    requiredKey(keyring, hmacKeyVersion),
  );

  return database.auditEvent.create({
    data: {
      eventId,
      actorId: input.actorId ?? null,
      documentId: input.documentId ?? null,
      action: input.action,
      outcome: input.outcome,
      resource: input.resource,
      targetId: input.targetId ?? null,
      reason: input.reason ?? null,
      requestId: input.context?.requestId ?? null,
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
      previousHash,
      hmacKeyVersion,
      occurredAt,
      metadata: metadata as Prisma.InputJsonValue,
      eventHash,
    },
  });
}

export async function appendAuditEvent(
  input: AppendAuditEventInput,
  database: PrismaClient = getDatabase(),
  keyring: AuditKeyring = getAuditKeyring(),
) {
  return runSerializableTransaction(database, (transaction) =>
    appendAuditEventInTransaction(transaction, input, keyring),
  );
}

export async function verifyStoredAuditChain(
  database: PrismaClient = getDatabase(),
  keyring: AuditKeyring = getAuditKeyring(),
) {
  const events = await database.auditEvent.findMany({ orderBy: { id: "asc" } });
  return verifyAuditChain(
    events.map((event) => ({
      id: event.id,
      eventId: event.eventId,
      actorId: event.actorId,
      documentId: event.documentId,
      action: event.action,
      outcome: event.outcome,
      resource: event.resource,
      targetId: event.targetId,
      reason: event.reason,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata as AuditJson,
      previousHash: event.previousHash,
      eventHash: event.eventHash,
      hmacKeyVersion: event.hmacKeyVersion,
      occurredAt: event.occurredAt.toISOString(),
    })),
    keyring.keyForVersion,
  );
}

