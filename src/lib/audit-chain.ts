import { createHmac, timingSafeEqual } from "node:crypto";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export type AuditJson =
  | null
  | boolean
  | number
  | string
  | AuditJson[]
  | { [key: string]: AuditJson };

export type AuditHashPayload = {
  eventId: string;
  actorId: string | null;
  documentId: string | null;
  action: string;
  outcome: string;
  resource: string;
  targetId: string | null;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: AuditJson;
  previousHash: string;
  hmacKeyVersion: number;
  occurredAt: string;
};

export type AuditChainRecord = AuditHashPayload & {
  id: bigint;
  eventHash: string;
};

function canonicalize(value: AuditJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] ?? null)}`)
    .join(",")}}`;
}

export function canonicalAuditPayload(payload: AuditHashPayload) {
  return canonicalize(payload as unknown as AuditJson);
}

export function computeAuditEventHash(
  payload: AuditHashPayload,
  key: Uint8Array,
) {
  return createHmac("sha256", key)
    .update(canonicalAuditPayload(payload), "utf8")
    .digest("hex");
}

function hashesEqual(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export type AuditVerificationResult =
  | { valid: true; eventCount: number; headHash: string }
  | {
      valid: false;
      eventCount: number;
      invalidEventId: string;
      reason: "BROKEN_LINK" | "UNKNOWN_KEY_VERSION" | "INVALID_HASH";
    };

export function verifyAuditChain(
  records: AuditChainRecord[],
  keyForVersion: (version: number) => Uint8Array | null,
): AuditVerificationResult {
  let expectedPreviousHash = AUDIT_GENESIS_HASH;

  for (const record of records) {
    if (!hashesEqual(record.previousHash, expectedPreviousHash)) {
      return {
        valid: false,
        eventCount: records.length,
        invalidEventId: record.eventId,
        reason: "BROKEN_LINK",
      };
    }

    const key = keyForVersion(record.hmacKeyVersion);
    if (!key) {
      return {
        valid: false,
        eventCount: records.length,
        invalidEventId: record.eventId,
        reason: "UNKNOWN_KEY_VERSION",
      };
    }

    const expectedHash = computeAuditEventHash(
      {
        eventId: record.eventId,
        actorId: record.actorId,
        documentId: record.documentId,
        action: record.action,
        outcome: record.outcome,
        resource: record.resource,
        targetId: record.targetId,
        reason: record.reason,
        requestId: record.requestId,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        metadata: record.metadata,
        previousHash: record.previousHash,
        hmacKeyVersion: record.hmacKeyVersion,
        occurredAt: record.occurredAt,
      },
      key,
    );
    if (!hashesEqual(record.eventHash, expectedHash)) {
      return {
        valid: false,
        eventCount: records.length,
        invalidEventId: record.eventId,
        reason: "INVALID_HASH",
      };
    }
    expectedPreviousHash = record.eventHash;
  }

  return {
    valid: true,
    eventCount: records.length,
    headHash: expectedPreviousHash,
  };
}

