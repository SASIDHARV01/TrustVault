import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    "prisma/migrations/20261022000100_initial_security_domain/migration.sql",
  ),
  "utf8",
);

describe("database security contract", () => {
  it("models system roles separately from document access", () => {
    expect(schema).toMatch(/enum SystemRole\s*{[\s\S]*?MEMBER[\s\S]*?ADMIN/);
    expect(schema).toMatch(/enum AccessLevel\s*{[\s\S]*?READ[\s\S]*?EDIT/);
    expect(schema).toContain("ownerId");
    expect(schema).toContain("recipientId");
  });

  it("preserves grant history while preventing duplicate active grants", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DocumentGrant_one_active_recipient_per_document"',
    );
    expect(migration).toContain('WHERE "revokedAt" IS NULL');
    expect(migration).toContain(
      'CONSTRAINT "DocumentGrant_revocation_fields_consistent"',
    );
  });

  it("makes audit events and checkpoints append-only in PostgreSQL", () => {
    expect(migration).toContain(
      'CREATE FUNCTION "trustvault_reject_immutable_mutation"()',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AuditEvent_reject_update_or_delete"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AuditCheckpoint_reject_update_or_delete"',
    );
  });

  it("requires hash-shaped evidence for versions and audit chains", () => {
    expect(migration).toContain(
      'CONSTRAINT "DocumentVersion_sha256_is_lowercase_hex"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AuditEvent_event_hash_is_lowercase_hex"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AuditCheckpoint_chain_hash_is_lowercase_hex"',
    );
  });
});
