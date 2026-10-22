import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import { createAuditKeyring } from "../src/lib/server/audit-config";
import { createActivityApiHandlers } from "../src/lib/server/activity-api-handlers";
import {
  listDocumentActivity,
  listSystemActivity,
  verifySystemAudit,
} from "../src/lib/server/activity-service";
import type { ApiActor } from "../src/lib/server/api-security";
import { appendAuditEvent, verifyStoredAuditChain } from "../src/lib/server/audit-service";
import { createDocumentApiHandlers } from "../src/lib/server/document-api-handlers";
import {
  getDocumentMetadata,
  updateDocumentMetadata,
} from "../src/lib/server/document-service";
import { createPermissionApiHandlers } from "../src/lib/server/permission-api-handlers";
import {
  createDocumentGrant,
  listDocumentGrants,
} from "../src/lib/server/permission-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;
const encodedKey = Buffer.alloc(32, 21).toString("base64");
const keyring = createAuditKeyring({
  currentVersion: 1,
  encodedKeys: { 1: encodedKey },
});

describeWithDatabase("tamper-evident audit PostgreSQL integration", () => {
  if (!databaseUrl) return;

  process.env.AUDIT_HMAC_KEY_VERSION = "1";
  process.env.AUDIT_HMAC_KEYS = JSON.stringify({ 1: encodedKey });
  process.env.APP_URL = "https://trustvault.test";

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 10 }),
  });
  const users = {
    owner: `audit-owner-${suffix}`,
    reader: `audit-reader-${suffix}`,
    unrelated: `audit-unrelated-${suffix}`,
    admin: `audit-admin-${suffix}`,
  };
  const documentId = `audit-document-${suffix}`;
  let currentActor: ApiActor = { id: users.owner, role: "MEMBER" };

  const documentHandlers = createDocumentApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    getDocument: (actor, targetDocumentId, context) =>
      getDocumentMetadata(actor, targetDocumentId, database, context),
    updateDocument: (actor, targetDocumentId, input, context) =>
      updateDocumentMetadata(actor, targetDocumentId, input, database, context),
  });
  const permissionHandlers = createPermissionApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    listGrants: (actor, targetDocumentId, context) =>
      listDocumentGrants(actor, targetDocumentId, database, context),
    createGrant: (actor, targetDocumentId, input, context) =>
      createDocumentGrant(actor, targetDocumentId, input, database, context),
  });
  const activityHandlers = createActivityApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    listDocument: (actor, targetDocumentId, query, context) =>
      listDocumentActivity(
        actor,
        targetDocumentId,
        query,
        database,
        context,
        keyring,
      ),
    listSystem: (actor, query, context) =>
      listSystemActivity(actor, query, database, context, keyring),
    verifySystem: (actor, context) =>
      verifySystemAudit(actor, database, context, keyring),
  });

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `Audit ${label}`,
        email: `${id}@trustvault.local`,
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
      })),
    });
    await database.document.create({
      data: { id: documentId, ownerId: users.owner, name: "Audit Evidence.pdf" },
    });
    await database.documentGrant.create({
      data: {
        id: `audit-reader-grant-${suffix}`,
        documentId,
        recipientId: users.reader,
        accessLevel: "READ",
        grantedById: users.owner,
      },
    });
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  function request(path: string, method = "GET", body?: Record<string, unknown>) {
    return new Request(`https://trustvault.test${path}`, {
      method,
      headers: {
        "user-agent": "trustvault-audit-test",
        "x-forwarded-for": "127.0.0.1",
        ...(body
          ? { "content-type": "application/json", origin: "https://trustvault.test" }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("serializes concurrent writers into one valid chain", async () => {
    const eventCountBefore = await database.auditEvent.count();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        appendAuditEvent(
          {
            action: "DOCUMENT_METADATA_READ",
            outcome: "ALLOWED",
            resource: "DOCUMENT",
            targetId: `concurrent-${index}`,
            reason: "CONCURRENCY_TEST",
          },
          database,
          keyring,
        ),
      ),
    );

    await expect(verifyStoredAuditChain(database, keyring)).resolves.toMatchObject({
      valid: true,
      eventCount: eventCountBefore + 12,
    });
  });

  it("keeps concurrent audited application reads in one valid chain", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        documentHandlers.get(
          request(`/api/documents/${documentId}`),
          documentId,
        ),
      ),
    );

    expect(responses.every(({ status }) => status === 200)).toBe(true);
    await expect(verifyStoredAuditChain(database, keyring)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("records allowed and refused document and permission actions", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const allowedRead = await documentHandlers.get(
      request(`/api/documents/${documentId}`),
      documentId,
    );
    expect(allowedRead.status).toBe(200);

    currentActor = { id: users.unrelated, role: "MEMBER" };
    const deniedRead = await documentHandlers.get(
      request(`/api/documents/${documentId}`),
      documentId,
    );
    const deniedGrant = await permissionHandlers.createGrant(
      request(`/api/documents/${documentId}/grants`, "POST", {
        recipientEmail: `${users.reader}@trustvault.local`,
        accessLevel: "EDIT",
      }),
      documentId,
    );
    expect(deniedRead.status).toBe(404);
    expect(deniedGrant.status).toBe(404);

    currentActor = { id: users.owner, role: "MEMBER" };
    const allowedGrantList = await permissionHandlers.listGrants(
      request(`/api/documents/${documentId}/grants`),
      documentId,
    );
    expect(allowedGrantList.status).toBe(200);

    const relevant = await database.auditEvent.findMany({
      where: { documentId },
      select: { action: true, outcome: true, actorId: true, requestId: true },
    });
    expect(relevant).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "DOCUMENT_METADATA_READ",
          outcome: "ALLOWED",
          actorId: users.owner,
        }),
        expect.objectContaining({
          action: "DOCUMENT_METADATA_READ",
          outcome: "DENIED",
          actorId: users.unrelated,
        }),
        expect.objectContaining({
          action: "PERMISSION_GRANT",
          outcome: "DENIED",
          actorId: users.unrelated,
        }),
        expect.objectContaining({
          action: "PERMISSION_LIST",
          outcome: "ALLOWED",
          actorId: users.owner,
        }),
      ]),
    );
    expect(relevant.every(({ requestId }) => requestId)).toBe(true);
  });

  it("enforces owner/admin activity boundaries and verifies integrity", async () => {
    currentActor = { id: users.reader, role: "MEMBER" };
    const recipientActivity = await activityHandlers.listDocument(
      request(`/api/documents/${documentId}/activity`),
      documentId,
    );
    const recipientSystem = await activityHandlers.listSystem(
      request("/api/admin/activity"),
    );
    expect(recipientActivity.status).toBe(404);
    expect(recipientSystem.status).toBe(403);

    currentActor = { id: users.owner, role: "MEMBER" };
    const ownerActivity = await activityHandlers.listDocument(
      request(`/api/documents/${documentId}/activity`),
      documentId,
    );
    expect(ownerActivity.status).toBe(200);

    currentActor = { id: users.admin, role: "ADMIN" };
    const systemActivity = await activityHandlers.listSystem(
      request("/api/admin/activity?limit=50"),
    );
    const verification = await activityHandlers.verifySystem(
      request("/api/admin/audit/verify", "POST", {}),
    );
    expect(systemActivity.status).toBe(200);
    expect(verification.status).toBe(200);
    await expect(verification.json()).resolves.toMatchObject({
      data: { verification: { valid: true } },
    });
  });

  it("rolls back a protected mutation when its audit event cannot be signed", async () => {
    const originalKeys = process.env.AUDIT_HMAC_KEYS;
    const originalVersion = process.env.AUDIT_HMAC_KEY_VERSION;
    const before = await database.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { name: true },
    });
    const auditCountBefore = await database.auditEvent.count({
      where: { documentId, action: "DOCUMENT_UPDATE" },
    });

    process.env.AUDIT_HMAC_KEY_VERSION = "2";
    process.env.AUDIT_HMAC_KEYS = JSON.stringify({ 1: encodedKey });
    try {
      await expect(
        updateDocumentMetadata(
          { id: users.owner, role: "MEMBER" },
          documentId,
          { name: "Must Roll Back.pdf" },
          database,
          {
            requestId: `rollback-${suffix}`,
            ipAddress: "127.0.0.1",
            userAgent: "trustvault-audit-test",
          },
        ),
      ).rejects.toThrow(/does not contain the current key version/);
    } finally {
      process.env.AUDIT_HMAC_KEYS = originalKeys;
      process.env.AUDIT_HMAC_KEY_VERSION = originalVersion;
    }

    await expect(
      database.document.findUniqueOrThrow({
        where: { id: documentId },
        select: { name: true },
      }),
    ).resolves.toEqual(before);
    await expect(
      database.auditEvent.count({
        where: { documentId, action: "DOCUMENT_UPDATE" },
      }),
    ).resolves.toBe(auditCountBefore);
  });

  it("rejects database mutation and does not store representative secrets", async () => {
    const first = await database.auditEvent.findFirstOrThrow({ orderBy: { id: "asc" } });
    await expect(
      database.auditEvent.update({
        where: { id: first.id },
        data: { reason: "tampered" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      database.auditEvent.delete({ where: { id: first.id } }),
    ).rejects.toThrow(/immutable/);

    const safeProjection = await database.auditEvent.findMany({
      select: { reason: true, metadata: true, userAgent: true },
    });
    const serialized = JSON.stringify(safeProjection);
    expect(serialized).not.toContain("correct-horse-battery-staple");
    expect(serialized).not.toContain("trustvault.session_token");
    expect(serialized).not.toContain("document body secret");
  });
});

