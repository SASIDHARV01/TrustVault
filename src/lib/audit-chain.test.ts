import { describe, expect, it } from "vitest";

import {
  AUDIT_GENESIS_HASH,
  computeAuditEventHash,
  type AuditChainRecord,
  type AuditHashPayload,
  verifyAuditChain,
} from "./audit-chain";

const key = Buffer.alloc(32, 7);

function createRecord(
  id: bigint,
  previousHash: string,
  overrides: Partial<AuditHashPayload> = {},
): AuditChainRecord {
  const payload: AuditHashPayload = {
    eventId: `event-${id}`,
    actorId: "actor-1",
    documentId: "document-1",
    action: "DOCUMENT_METADATA_READ",
    outcome: "ALLOWED",
    resource: "DOCUMENT",
    targetId: "document-1",
    reason: "ALLOW_OWNER",
    requestId: `request-${id}`,
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    metadata: { nested: { b: 2, a: 1 } },
    previousHash,
    hmacKeyVersion: 1,
    occurredAt: `2026-10-22T00:00:0${id}.000Z`,
    ...overrides,
  };
  return { id, ...payload, eventHash: computeAuditEventHash(payload, key) };
}

function validChain() {
  const first = createRecord(BigInt(1), AUDIT_GENESIS_HASH);
  const second = createRecord(BigInt(2), first.eventHash);
  const third = createRecord(BigInt(3), second.eventHash);
  return [first, second, third];
}

describe("tamper-evident audit chain", () => {
  it("produces deterministic hashes for canonically equivalent metadata", () => {
    const first = createRecord(BigInt(1), AUDIT_GENESIS_HASH, {
      metadata: { z: 1, nested: { b: true, a: false } },
    });
    const second = createRecord(BigInt(1), AUDIT_GENESIS_HASH, {
      metadata: { nested: { a: false, b: true }, z: 1 },
    });
    expect(first.eventHash).toBe(second.eventHash);
  });

  it("verifies an intact chain", () => {
    expect(verifyAuditChain(validChain(), () => key)).toMatchObject({
      valid: true,
      eventCount: 3,
    });
  });

  it("detects changed event data", () => {
    const records = validChain();
    records[1] = { ...records[1], outcome: "DENIED" };
    expect(verifyAuditChain(records, () => key)).toMatchObject({
      valid: false,
      invalidEventId: "event-2",
      reason: "INVALID_HASH",
    });
  });

  it("detects removed and reordered events", () => {
    const records = validChain();
    expect(verifyAuditChain([records[0], records[2]], () => key)).toMatchObject({
      valid: false,
      reason: "BROKEN_LINK",
    });
    expect(verifyAuditChain([records[1], records[0]], () => key)).toMatchObject({
      valid: false,
      reason: "BROKEN_LINK",
    });
  });

  it("fails clearly when a historical key version is unavailable", () => {
    const records = validChain();
    expect(verifyAuditChain(records, () => null)).toMatchObject({
      valid: false,
      reason: "UNKNOWN_KEY_VERSION",
    });
  });
});

