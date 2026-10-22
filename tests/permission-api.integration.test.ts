import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import type { ApiActor } from "../src/lib/server/api-security";
import { createDocumentApiHandlers } from "../src/lib/server/document-api-handlers";
import {
  getDocumentMetadata,
  updateDocumentMetadata,
} from "../src/lib/server/document-service";
import { createPermissionApiHandlers } from "../src/lib/server/permission-api-handlers";
import {
  createDocumentGrant,
  listDocumentGrants,
  lookupEligibleRecipient,
  revokeDocumentGrant,
  updateDocumentGrant,
} from "../src/lib/server/permission-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;

describeWithDatabase("permission API PostgreSQL integration", () => {
  if (!databaseUrl) return;

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });
  const users = {
    owner: `permission-owner-${suffix}`,
    reader: `permission-reader-${suffix}`,
    editor: `permission-editor-${suffix}`,
    unrelated: `permission-unrelated-${suffix}`,
    admin: `permission-admin-${suffix}`,
    disabled: `permission-disabled-${suffix}`,
  };
  const emails = Object.fromEntries(
    Object.entries(users).map(([label, id]) => [
      label,
      `${id}@trustvault.local`,
    ]),
  ) as Record<keyof typeof users, string>;
  const documentId = `permission-document-${suffix}`;
  const readerGrantId = `permission-read-${suffix}`;
  const editorGrantId = `permission-edit-${suffix}`;
  let currentActor: ApiActor = { id: users.owner, role: "MEMBER" };

  const permissionHandlers = createPermissionApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    lookupRecipient: (actor, email) =>
      lookupEligibleRecipient(actor, email, database),
    listGrants: (actor, targetDocumentId) =>
      listDocumentGrants(actor, targetDocumentId, database),
    createGrant: (actor, targetDocumentId, input) =>
      createDocumentGrant(actor, targetDocumentId, input, database),
    updateGrant: (actor, targetDocumentId, grantId, input) =>
      updateDocumentGrant(actor, targetDocumentId, grantId, input, database),
    revokeGrant: (actor, targetDocumentId, grantId) =>
      revokeDocumentGrant(actor, targetDocumentId, grantId, database),
  });
  const documentHandlers = createDocumentApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    getDocument: (actor, targetDocumentId) =>
      getDocumentMetadata(actor, targetDocumentId, database),
    updateDocument: (actor, targetDocumentId, input) =>
      updateDocumentMetadata(actor, targetDocumentId, input, database),
  });

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `Permission ${label}`,
        email: emails[label as keyof typeof users],
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
        disabledAt: label === "disabled" ? new Date() : null,
      })),
    });
    await database.document.create({
      data: {
        id: documentId,
        ownerId: users.owner,
        name: "Permission Test.pdf",
      },
    });
    await database.documentGrant.createMany({
      data: [
        {
          id: readerGrantId,
          documentId,
          recipientId: users.reader,
          accessLevel: "READ",
          grantedById: users.owner,
        },
        {
          id: editorGrantId,
          documentId,
          recipientId: users.editor,
          accessLevel: "EDIT",
          grantedById: users.owner,
        },
        {
          id: `permission-history-${suffix}`,
          documentId,
          recipientId: users.unrelated,
          accessLevel: "READ",
          grantedById: users.owner,
          revokedAt: new Date(),
          revokedById: users.owner,
        },
      ],
    });
  });

  afterAll(async () => {
    await database.documentGrant.deleteMany({ where: { documentId } });
    await database.document.deleteMany({ where: { id: documentId } });
    await database.user.deleteMany({
      where: { id: { in: Object.values(users) } },
    });
    await database.$disconnect();
  });

  function request(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
  ) {
    return new Request(`https://trustvault.test${path}`, {
      method,
      headers: body
        ? { "content-type": "application/json", origin: "https://trustvault.test" }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function body(response: Response) {
    return (await response.json()) as {
      data?: {
        recipient?: { id: string; name: string; email: string };
        grant?: {
          id: string;
          accessLevel: string;
          status: string;
          recipient: { id: string };
        };
        grants?: Array<{ id: string; status: string }>;
        document?: { id: string; name: string };
      };
      error?: { code: string; message: string };
    };
  }

  it("looks up only an exact eligible recipient without exposing system roles", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const found = await permissionHandlers.lookupRecipient(
      request(`/api/recipients?email=${encodeURIComponent(emails.editor)}`),
    );
    const foundBody = await body(found);
    expect(found.status).toBe(200);
    expect(foundBody.data?.recipient).toEqual({
      id: users.editor,
      name: "Permission editor",
      email: emails.editor,
    });
    expect(foundBody.data?.recipient).not.toHaveProperty("role");

    const disabled = await permissionHandlers.lookupRecipient(
      request(`/api/recipients?email=${encodeURIComponent(emails.disabled)}`),
    );
    const self = await permissionHandlers.lookupRecipient(
      request(`/api/recipients?email=${encodeURIComponent(emails.owner)}`),
    );
    const missing = await permissionHandlers.lookupRecipient(
      request("/api/recipients?email=missing%40trustvault.local"),
    );
    expect(disabled.status).toBe(404);
    expect(self.status).toBe(404);
    expect(await body(disabled)).toEqual(await body(missing));
  });

  it("allows only the owner to list or mutate grants", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const ownerList = await permissionHandlers.listGrants(
      request(`/api/documents/${documentId}/grants`),
      documentId,
    );
    expect(ownerList.status).toBe(200);
    expect((await body(ownerList)).data?.grants).toHaveLength(3);

    for (const forbiddenActor of [
      { id: users.reader, role: "MEMBER" as const },
      { id: users.admin, role: "ADMIN" as const },
    ]) {
      currentActor = forbiddenActor;
      const list = await permissionHandlers.listGrants(
        request(`/api/documents/${documentId}/grants`),
        documentId,
      );
      const create = await permissionHandlers.createGrant(
        request(`/api/documents/${documentId}/grants`, "POST", {
          recipientEmail: emails.unrelated,
          accessLevel: "READ",
        }),
        documentId,
      );
      const update = await permissionHandlers.updateGrant(
        request(
          `/api/documents/${documentId}/grants/${editorGrantId}`,
          "PATCH",
          { accessLevel: "READ" },
        ),
        documentId,
        editorGrantId,
      );
      const revoke = await permissionHandlers.revokeGrant(
        request(
          `/api/documents/${documentId}/grants/${editorGrantId}`,
          "DELETE",
        ),
        documentId,
        editorGrantId,
      );
      expect(list.status).toBe(404);
      expect(create.status).toBe(404);
      expect(update.status).toBe(404);
      expect(revoke.status).toBe(404);
    }
  });

  it("creates one active grant and rejects duplicate or ineligible recipients", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const created = await permissionHandlers.createGrant(
      request(`/api/documents/${documentId}/grants`, "POST", {
        recipientEmail: emails.unrelated,
        accessLevel: "READ",
      }),
      documentId,
    );
    const createdBody = await body(created);
    expect(created.status).toBe(201);
    expect(createdBody.data?.grant).toMatchObject({
      accessLevel: "READ",
      status: "ACTIVE",
      recipient: { id: users.unrelated },
    });

    const unchanged = await permissionHandlers.updateGrant(
      request(
        `/api/documents/${documentId}/grants/${createdBody.data?.grant?.id}`,
        "PATCH",
        { accessLevel: "READ" },
      ),
      documentId,
      createdBody.data?.grant?.id ?? "missing",
    );
    expect(unchanged.status).toBe(409);
    expect((await body(unchanged)).error?.code).toBe("GRANT_UNCHANGED");

    const duplicate = await permissionHandlers.createGrant(
      request(`/api/documents/${documentId}/grants`, "POST", {
        recipientEmail: emails.unrelated,
        accessLevel: "EDIT",
      }),
      documentId,
    );
    expect(duplicate.status).toBe(409);
    expect((await body(duplicate)).error?.code).toBe("ACTIVE_GRANT_EXISTS");

    for (const recipientEmail of [emails.owner, emails.disabled]) {
      const result = await permissionHandlers.createGrant(
        request(`/api/documents/${documentId}/grants`, "POST", {
          recipientEmail,
          accessLevel: "READ",
        }),
        documentId,
      );
      expect(result.status).toBe(404);
      expect((await body(result)).error?.code).toBe("RECIPIENT_NOT_FOUND");
    }
  });

  it("changes access by revoking the old row and creating a replacement", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const changed = await permissionHandlers.updateGrant(
      request(
        `/api/documents/${documentId}/grants/${readerGrantId}`,
        "PATCH",
        { accessLevel: "EDIT" },
      ),
      documentId,
      readerGrantId,
    );
    const changedBody = await body(changed);
    expect(changed.status).toBe(200);
    expect(changedBody.data?.grant?.accessLevel).toBe("EDIT");
    expect(changedBody.data?.grant?.id).not.toBe(readerGrantId);

    const oldGrant = await database.documentGrant.findUniqueOrThrow({
      where: { id: readerGrantId },
    });
    expect(oldGrant.revokedAt).not.toBeNull();
    expect(oldGrant.revokedById).toBe(users.owner);

    currentActor = { id: users.reader, role: "MEMBER" };
    const edit = await documentHandlers.update(
      request(`/api/documents/${documentId}`, "PATCH", {
        name: "Reader promoted to editor.pdf",
      }),
      documentId,
    );
    expect(edit.status).toBe(200);
  });

  it("revokes access immediately while preserving the grant row", async () => {
    currentActor = { id: users.editor, role: "MEMBER" };
    const before = await documentHandlers.get(
      request(`/api/documents/${documentId}`),
      documentId,
    );
    expect(before.status).toBe(200);

    currentActor = { id: users.owner, role: "MEMBER" };
    const revoked = await permissionHandlers.revokeGrant(
      request(`/api/documents/${documentId}/grants/${editorGrantId}`, "DELETE"),
      documentId,
      editorGrantId,
    );
    expect(revoked.status).toBe(200);
    expect((await body(revoked)).data?.grant?.status).toBe("REVOKED");

    currentActor = { id: users.editor, role: "MEMBER" };
    const after = await documentHandlers.get(
      request(`/api/documents/${documentId}`),
      documentId,
    );
    expect(after.status).toBe(404);

    const preserved = await database.documentGrant.findUniqueOrThrow({
      where: { id: editorGrantId },
    });
    expect(preserved.revokedAt).not.toBeNull();
    expect(preserved.revokedById).toBe(users.owner);
  });
});

