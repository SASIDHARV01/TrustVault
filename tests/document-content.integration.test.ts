import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import type { ObjectStorage } from "../src/lib/object-storage";
import { parseObjectStorageKey } from "../src/lib/object-storage";
import { createAuditCheckpoint } from "../src/lib/server/audit-checkpoint-service";
import {
  createDocumentVersion,
  DocumentContentServiceError,
  getDocumentVersionContent,
  listDocumentVersions,
} from "../src/lib/server/document-content-service";
import { InMemoryObjectStorage } from "../src/lib/testing/in-memory-object-storage";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;
const encodedKey = Buffer.alloc(32, 21).toString("base64");
const auditContext = {
  requestId: `content-${suffix}`,
  ipAddress: "127.0.0.1",
  userAgent: "trustvault-content-test",
};
const pdfCandidate = {
  originalFilename: "Salary-Letter.pdf",
  declaredMimeType: "application/pdf",
  bytes: Uint8Array.from(Buffer.from("%PDF-1.7\nconfidential")),
};

describeWithDatabase("secure document content PostgreSQL integration", () => {
  if (!databaseUrl) return;

  process.env.AUDIT_HMAC_KEY_VERSION = "1";
  process.env.AUDIT_HMAC_KEYS = JSON.stringify({ 1: encodedKey });

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 10 }),
  });
  const storage = new InMemoryObjectStorage();
  const users = {
    owner: `content-owner-${suffix}`,
    reader: `content-reader-${suffix}`,
    editor: `content-editor-${suffix}`,
    unrelated: `content-unrelated-${suffix}`,
    admin: `content-admin-${suffix}`,
  };
  const documentId = `content-document-${suffix}`;
  let firstVersionId = "";

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `Content ${label}`,
        email: `${id}@trustvault.local`,
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
      })),
    });
    await database.document.create({
      data: { id: documentId, ownerId: users.owner, name: "Salary Letter" },
    });
    await database.documentGrant.createMany({
      data: [
        {
          id: `content-reader-grant-${suffix}`,
          documentId,
          recipientId: users.reader,
          accessLevel: "READ",
          grantedById: users.owner,
        },
        {
          id: `content-editor-grant-${suffix}`,
          documentId,
          recipientId: users.editor,
          accessLevel: "EDIT",
          grantedById: users.owner,
        },
      ],
    });
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("allows owner/editor uploads but denies reader, unrelated, and ordinary admin uploads", async () => {
    const first = await createDocumentVersion(
      { id: users.owner, role: "MEMBER" },
      documentId,
      pdfCandidate,
      database,
      storage,
      auditContext,
    );
    firstVersionId = first.id;
    expect(first).toMatchObject({ versionNumber: 1, storageState: "READY" });

    await expect(createDocumentVersion(
      { id: users.reader, role: "MEMBER" },
      documentId,
      pdfCandidate,
      database,
      storage,
      auditContext,
    )).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(createDocumentVersion(
      { id: users.unrelated, role: "MEMBER" },
      documentId,
      pdfCandidate,
      database,
      storage,
      auditContext,
    )).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(createDocumentVersion(
      { id: users.admin, role: "ADMIN" },
      documentId,
      pdfCandidate,
      database,
      storage,
      auditContext,
    )).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const second = await createDocumentVersion(
      { id: users.editor, role: "MEMBER" },
      documentId,
      { ...pdfCandidate, originalFilename: "Salary-Letter-v2.pdf" },
      database,
      storage,
      auditContext,
    );
    expect(second.versionNumber).toBe(2);
  });

  it("serializes concurrent version numbers without collisions", async () => {
    const versions = await Promise.all(
      Array.from({ length: 3 }, (_, index) => createDocumentVersion(
        { id: users.editor, role: "MEMBER" },
        documentId,
        { ...pdfCandidate, originalFilename: `Revision-${index + 3}.pdf` },
        database,
        storage,
        { ...auditContext, requestId: `${auditContext.requestId}-${index}` },
      )),
    );
    expect(versions.map(({ versionNumber }) => versionNumber).sort()).toEqual([3, 4, 5]);
  });

  it("rechecks grants on every read and revocation stops the next request", async () => {
    const reader = { id: users.reader, role: "MEMBER" as const };
    await expect(listDocumentVersions(reader, documentId, database, auditContext)).resolves.toHaveLength(5);
    await expect(getDocumentVersionContent(
      reader,
      documentId,
      firstVersionId,
      "attachment",
      null,
      database,
      storage,
      auditContext,
    )).resolves.toMatchObject({ mimeType: "application/pdf" });

    await database.documentGrant.update({
      where: { id: `content-reader-grant-${suffix}` },
      data: { revokedAt: new Date(), revokedById: users.owner },
    });
    await expect(getDocumentVersionContent(
      reader,
      documentId,
      firstVersionId,
      "attachment",
      null,
      database,
      storage,
      auditContext,
    )).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("requires and audits an explicit administrator override reason", async () => {
    const admin = { id: users.admin, role: "ADMIN" as const };
    await expect(getDocumentVersionContent(
      admin,
      documentId,
      firstVersionId,
      "inline",
      null,
      database,
      storage,
      auditContext,
    )).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
    await expect(getDocumentVersionContent(
      admin,
      documentId,
      firstVersionId,
      "inline",
      "Investigating incident TV-2026-42",
      database,
      storage,
      auditContext,
    )).resolves.toMatchObject({ filename: "Salary-Letter.pdf" });

    await expect(database.auditEvent.findMany({
      where: { actorId: users.admin, action: "ADMIN_OVERRIDE_READ" },
      select: { outcome: true, metadata: true },
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "DENIED" }),
      expect.objectContaining({
        outcome: "ALLOWED",
        metadata: expect.objectContaining({ overrideReason: "Investigating incident TV-2026-42" }),
      }),
    ]));
  });

  it("marks storage failures and rejects mismatched object metadata", async () => {
    const failingStorage: ObjectStorage = {
      ...storage,
      put: async () => {
        throw new Error("provider unavailable");
      },
      get: storage.get.bind(storage),
      head: storage.head.bind(storage),
      delete: storage.delete.bind(storage),
    };
    await expect(createDocumentVersion(
      { id: users.owner, role: "MEMBER" },
      documentId,
      { ...pdfCandidate, originalFilename: "Failed.pdf" },
      database,
      failingStorage,
      auditContext,
    )).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    await expect(database.documentVersion.findFirst({
      where: { documentId, originalFilename: "Failed.pdf" },
      select: { storageState: true },
    })).resolves.toEqual({ storageState: "FAILED" });

    const mismatchedStorage: ObjectStorage = {
      put: storage.put.bind(storage),
      head: storage.head.bind(storage),
      delete: storage.delete.bind(storage),
      get: async (key) => {
        const original = await storage.get(key);
        return {
          ...original,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(original.contentLength ?? 0));
              controller.close();
            },
          }),
        };
      },
    };
    await expect(getDocumentVersionContent(
      { id: users.owner, role: "MEMBER" },
      documentId,
      firstVersionId,
      "inline",
      null,
      database,
      mismatchedStorage,
      auditContext,
    )).rejects.toBeInstanceOf(DocumentContentServiceError);
  });

  it("writes an external chain-head checkpoint and makes its database row immutable", async () => {
    const checkpoint = await createAuditCheckpoint(
      { id: users.admin, role: "ADMIN" },
      database,
      storage,
      auditContext,
    );
    const stored = await database.auditCheckpoint.findUniqueOrThrow({
      where: { id: checkpoint.id },
      select: { storageKey: true },
    });
    expect(storage.has(parseObjectStorageKey(stored.storageKey))).toBe(true);
    await expect(database.auditCheckpoint.delete({
      where: { id: checkpoint.id },
    })).rejects.toThrow(/immutable/);
  });
});
