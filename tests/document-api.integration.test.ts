import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import type { ApiActor } from "../src/lib/server/api-security";
import { createDocumentApiHandlers } from "../src/lib/server/document-api-handlers";
import {
  createDocumentMetadata,
  deleteDocument,
  getDocumentMetadata,
  listAccessibleDocuments,
  restoreDocument,
  updateDocumentMetadata,
} from "../src/lib/server/document-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;

describeWithDatabase("document metadata API PostgreSQL integration", () => {
  if (!databaseUrl) return;

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });
  const users = {
    owner: `api-owner-${suffix}`,
    reader: `api-reader-${suffix}`,
    editor: `api-editor-${suffix}`,
    unrelated: `api-unrelated-${suffix}`,
    admin: `api-admin-${suffix}`,
  };
  const targetDocumentId = `api-target-${suffix}`;
  const unrelatedDocumentId = `api-unrelated-document-${suffix}`;
  const ownerCategoryId = `api-owner-category-${suffix}`;
  const unrelatedCategoryId = `api-unrelated-category-${suffix}`;
  let currentActor: ApiActor = { id: users.owner, role: "MEMBER" };

  const handlers = createDocumentApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    listDocuments: (actor, query) =>
      listAccessibleDocuments(actor, query, database),
    createDocument: (actor, input) =>
      createDocumentMetadata(actor, input, database),
    getDocument: (actor, documentId) =>
      getDocumentMetadata(actor, documentId, database),
    updateDocument: (actor, documentId, input) =>
      updateDocumentMetadata(actor, documentId, input, database),
    deleteDocument: (actor, documentId) =>
      deleteDocument(actor, documentId, database),
    restoreDocument: (actor, documentId) =>
      restoreDocument(actor, documentId, database),
  });

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `API ${label}`,
        email: `${id}@trustvault.local`,
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
      })),
    });
    await database.category.createMany({
      data: [
        {
          id: ownerCategoryId,
          ownerId: users.owner,
          name: "Owner category",
          normalizedName: `owner-${suffix}`,
        },
        {
          id: unrelatedCategoryId,
          ownerId: users.unrelated,
          name: "Unrelated category",
          normalizedName: `unrelated-${suffix}`,
        },
      ],
    });
    await database.document.createMany({
      data: [
        {
          id: targetDocumentId,
          ownerId: users.owner,
          categoryId: ownerCategoryId,
          name: "Private Salary Letter.pdf",
        },
        {
          id: unrelatedDocumentId,
          ownerId: users.unrelated,
          categoryId: unrelatedCategoryId,
          name: "Unrelated Document.pdf",
        },
      ],
    });
    await database.documentGrant.createMany({
      data: [
        {
          id: `api-read-grant-${suffix}`,
          documentId: targetDocumentId,
          recipientId: users.reader,
          accessLevel: "READ",
          grantedById: users.owner,
        },
        {
          id: `api-edit-grant-${suffix}`,
          documentId: targetDocumentId,
          recipientId: users.editor,
          accessLevel: "EDIT",
          grantedById: users.owner,
        },
      ],
    });
  });

  afterAll(async () => {
    await database.documentGrant.deleteMany({
      where: { document: { ownerId: { in: Object.values(users) } } },
    });
    await database.document.deleteMany({
      where: { ownerId: { in: Object.values(users) } },
    });
    await database.category.deleteMany({
      where: { ownerId: { in: Object.values(users) } },
    });
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
        document?: { id: string; name: string; state: string; owner: { id: string } };
        documents?: Array<{ id: string }>;
      };
      error?: { code: string; message: string };
    };
  }

  it("filters discovery in PostgreSQL for recipients, unrelated users, and administrators", async () => {
    currentActor = { id: users.reader, role: "MEMBER" };
    const readerResult = await handlers.list(
      request("/api/documents?q=salary"),
    );
    const readerBody = await body(readerResult);
    expect(readerResult.status).toBe(200);
    expect(readerBody.data?.documents?.map(({ id }) => id)).toEqual([
      targetDocumentId,
    ]);

    currentActor = { id: users.unrelated, role: "MEMBER" };
    const unrelatedResult = await handlers.list(request("/api/documents"));
    const unrelatedBody = await body(unrelatedResult);
    expect(unrelatedBody.data?.documents?.map(({ id }) => id)).toEqual([
      unrelatedDocumentId,
    ]);

    currentActor = { id: users.admin, role: "ADMIN" };
    const adminResult = await handlers.list(request("/api/documents"));
    const adminBody = await body(adminResult);
    expect(adminBody.data?.documents?.map(({ id }) => id)).toEqual(
      expect.arrayContaining([targetDocumentId, unrelatedDocumentId]),
    );
  });

  it("combines name, owner, category, date, and sorting with the access predicate", async () => {
    currentActor = { id: users.reader, role: "MEMBER" };
    const readerFiltered = await handlers.list(request(
      `/api/documents?q=salary&owner=${encodeURIComponent("API owner")}&categoryId=${ownerCategoryId}&createdFrom=${encodeURIComponent("2020-01-01T00:00:00.000Z")}&createdTo=${encodeURIComponent("2030-01-01T00:00:00.000Z")}&sort=name&order=asc`,
    ));
    expect((await body(readerFiltered)).data?.documents?.map(({ id }) => id)).toEqual([
      targetDocumentId,
    ]);

    const foreignCategory = await handlers.list(request(
      `/api/documents?categoryId=${unrelatedCategoryId}`,
    ));
    expect((await body(foreignCategory)).data?.documents).toEqual([]);

    currentActor = { id: users.unrelated, role: "MEMBER" };
    const ownerProbe = await handlers.list(request(
      `/api/documents?ownerId=${users.owner}&category=${encodeURIComponent("Owner category")}`,
    ));
    expect((await body(ownerProbe)).data?.documents).toEqual([]);

    currentActor = { id: users.admin, role: "ADMIN" };
    const adminOwnerFilter = await handlers.list(request(
      `/api/documents?ownerId=${users.owner}`,
    ));
    expect((await body(adminOwnerFilter)).data?.documents?.map(({ id }) => id)).toEqual([
      targetDocumentId,
    ]);
  });

  it("returns the same response for missing and inaccessible documents", async () => {
    currentActor = { id: users.unrelated, role: "MEMBER" };
    const inaccessible = await handlers.get(
      request(`/api/documents/${targetDocumentId}`),
      targetDocumentId,
    );
    const missing = await handlers.get(
      request("/api/documents/does-not-exist"),
      "does-not-exist",
    );

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await body(inaccessible)).toEqual(await body(missing));
  });

  it("enforces READ, EDIT, owner, and administrator mutation boundaries", async () => {
    currentActor = { id: users.reader, role: "MEMBER" };
    const readerUpdate = await handlers.update(
      request(`/api/documents/${targetDocumentId}`, "PATCH", {
        name: "Reader changed this.pdf",
      }),
      targetDocumentId,
    );
    expect(readerUpdate.status).toBe(404);

    currentActor = { id: users.editor, role: "MEMBER" };
    const editorUpdate = await handlers.update(
      request(`/api/documents/${targetDocumentId}`, "PATCH", {
        name: "Editor Metadata Update.pdf",
      }),
      targetDocumentId,
    );
    expect(editorUpdate.status).toBe(200);
    expect((await body(editorUpdate)).data?.document?.name).toBe(
      "Editor Metadata Update.pdf",
    );

    const editorDelete = await handlers.remove(
      request(`/api/documents/${targetDocumentId}`, "DELETE"),
      targetDocumentId,
    );
    expect(editorDelete.status).toBe(404);

    currentActor = { id: users.admin, role: "ADMIN" };
    const adminDelete = await handlers.remove(
      request(`/api/documents/${targetDocumentId}`, "DELETE"),
      targetDocumentId,
    );
    expect(adminDelete.status).toBe(404);

    currentActor = { id: users.owner, role: "MEMBER" };
    const ownerDelete = await handlers.remove(
      request(`/api/documents/${targetDocumentId}`, "DELETE"),
      targetDocumentId,
    );
    expect(ownerDelete.status).toBe(200);
    expect((await body(ownerDelete)).data?.document?.state).toBe("DELETED");

    currentActor = { id: users.unrelated, role: "MEMBER" };
    const deletedOwnerProbe = await handlers.list(request(
      `/api/documents?state=DELETED&ownerId=${users.owner}`,
    ));
    expect((await body(deletedOwnerProbe)).data?.documents).toEqual([]);

    currentActor = { id: users.reader, role: "MEMBER" };
    const deletedRead = await handlers.get(
      request(`/api/documents/${targetDocumentId}`),
      targetDocumentId,
    );
    expect(deletedRead.status).toBe(404);

    currentActor = { id: users.admin, role: "ADMIN" };
    const adminMetadata = await handlers.get(
      request(`/api/documents/${targetDocumentId}`),
      targetDocumentId,
    );
    expect(adminMetadata.status).toBe(200);
    const adminRestore = await handlers.restore(
      request(`/api/documents/${targetDocumentId}/restore`, "POST"),
      targetDocumentId,
    );
    expect(adminRestore.status).toBe(404);

    currentActor = { id: users.owner, role: "MEMBER" };
    const ownerRestore = await handlers.restore(
      request(`/api/documents/${targetDocumentId}/restore`, "POST"),
      targetDocumentId,
    );
    expect(ownerRestore.status).toBe(200);
    expect((await body(ownerRestore)).data?.document?.state).toBe("ACTIVE");
  });

  it("derives ownership from the session and validates category ownership", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const created = await handlers.create(
      request("/api/documents", "POST", {
        name: "Created through API.pdf",
        categoryId: ownerCategoryId,
      }),
    );
    expect(created.status).toBe(201);
    expect((await body(created)).data?.document?.owner.id).toBe(users.owner);

    const foreignCategory = await handlers.create(
      request("/api/documents", "POST", {
        name: "Wrong category.pdf",
        categoryId: unrelatedCategoryId,
      }),
    );
    expect(foreignCategory.status).toBe(400);
    expect((await body(foreignCategory)).error?.code).toBe("INVALID_CATEGORY");
  });

  it("makes grant revocation effective on the next metadata request", async () => {
    currentActor = { id: users.reader, role: "MEMBER" };
    const before = await handlers.get(
      request(`/api/documents/${targetDocumentId}`),
      targetDocumentId,
    );
    expect(before.status).toBe(200);

    await database.documentGrant.update({
      where: { id: `api-read-grant-${suffix}` },
      data: { revokedAt: new Date(), revokedById: users.owner },
    });

    const after = await handlers.get(
      request(`/api/documents/${targetDocumentId}`),
      targetDocumentId,
    );
    expect(after.status).toBe(404);
  });
});

