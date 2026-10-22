import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import type { ApiActor } from "../src/lib/server/api-security";
import { createCategoryApiHandlers } from "../src/lib/server/category-api-handlers";
import {
  createOwnedCategory,
  deleteOwnedCategory,
  listOwnedCategories,
  updateOwnedCategory,
} from "../src/lib/server/category-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;
const encodedKey = Buffer.alloc(32, 21).toString("base64");

describeWithDatabase("owner-scoped category PostgreSQL integration", () => {
  if (!databaseUrl) return;

  process.env.AUDIT_HMAC_KEY_VERSION = "1";
  process.env.AUDIT_HMAC_KEYS = JSON.stringify({ 1: encodedKey });

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }),
  });
  const users = {
    owner: `category-owner-${suffix}`,
    outsider: `category-outsider-${suffix}`,
    admin: `category-admin-${suffix}`,
  };
  const documentId = `category-document-${suffix}`;
  let currentActor: ApiActor = { id: users.owner, role: "MEMBER" };

  const handlers = createCategoryApiHandlers({
    getActor: async () => currentActor,
    trustedMutationOrigin: () => true,
    listCategories: (actor) => listOwnedCategories(actor, database),
    createCategory: (actor, input, context) =>
      createOwnedCategory(actor, input, database, context),
    updateCategory: (actor, categoryId, input, context) =>
      updateOwnedCategory(actor, categoryId, input, database, context),
    deleteCategory: (actor, categoryId, context) =>
      deleteOwnedCategory(actor, categoryId, database, context),
  });

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `Category ${label}`,
        email: `${id}@trustvault.local`,
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
      })),
    });
    await database.document.create({
      data: { id: documentId, ownerId: users.owner, name: "Organized evidence" },
    });
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  function request(method = "GET", body?: unknown) {
    return new Request("https://trustvault.test/api/categories", {
      method,
      headers: body
        ? { "content-type": "application/json", origin: "https://trustvault.test" }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function responseBody(response: Response) {
    return await response.json() as {
      data?: {
        category?: { id: string; name: string; activeDocumentCount: number };
        categories?: Array<{ id: string; name: string }>;
      };
      error?: { code: string };
    };
  }

  it("creates normalized owner categories and rejects equivalent duplicates", async () => {
    const createdResponse = await handlers.create(
      request("POST", { name: "  Project　 Alpha  " }),
    );
    const created = (await responseBody(createdResponse)).data?.category;
    expect(createdResponse.status).toBe(201);
    expect(created?.name).toBe("Project Alpha");

    const duplicate = await handlers.create(
      request("POST", { name: "project alpha" }),
    );
    expect(duplicate.status).toBe(409);
    expect((await responseBody(duplicate)).error?.code).toBe("CATEGORY_ALREADY_EXISTS");
  });

  it("lists only the authenticated owner's categories", async () => {
    await database.category.create({
      data: {
        id: `outsider-category-${suffix}`,
        ownerId: users.outsider,
        name: "Outsider only",
        normalizedName: `outsider-${suffix}`,
      },
    });

    currentActor = { id: users.owner, role: "MEMBER" };
    const ownerList = await handlers.list();
    expect((await responseBody(ownerList)).data?.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Project Alpha" })]),
    );
    expect(JSON.stringify(await responseBody(await handlers.list()))).not.toContain("Outsider only");
  });

  it("denies cross-owner and administrator category mutation without revealing existence", async () => {
    const ownerCategory = await database.category.findFirstOrThrow({
      where: { ownerId: users.owner },
      select: { id: true },
    });

    currentActor = { id: users.outsider, role: "MEMBER" };
    const outsiderUpdate = await handlers.update(
      request("PATCH", { name: "Stolen" }),
      ownerCategory.id,
    );
    currentActor = { id: users.admin, role: "ADMIN" };
    const adminDelete = await handlers.remove(request("DELETE"), ownerCategory.id);

    expect(outsiderUpdate.status).toBe(404);
    expect(adminDelete.status).toBe(404);
    expect(await outsiderUpdate.json()).toEqual(await adminDelete.json());
  });

  it("renames and deletes an owned category while safely detaching documents", async () => {
    currentActor = { id: users.owner, role: "MEMBER" };
    const category = await database.category.findFirstOrThrow({
      where: { ownerId: users.owner },
      select: { id: true },
    });
    await database.document.update({
      where: { id: documentId },
      data: { categoryId: category.id },
    });

    const renamed = await handlers.update(
      request("PATCH", { name: "Legal Records" }),
      category.id,
    );
    expect((await responseBody(renamed)).data?.category).toMatchObject({
      name: "Legal Records",
      activeDocumentCount: 1,
    });

    const removed = await handlers.remove(request("DELETE"), category.id);
    expect(removed.status).toBe(200);
    await expect(database.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { categoryId: true },
    })).resolves.toEqual({ categoryId: null });
  });

  it("records allowed and denied category mutations without storing names", async () => {
    const events = await database.auditEvent.findMany({
      where: {
        actorId: { in: Object.values(users) },
        resource: "CATEGORY",
      },
      select: { action: true, outcome: true, metadata: true },
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "CATEGORY_CREATE", outcome: "ALLOWED" }),
      expect.objectContaining({ action: "CATEGORY_CREATE", outcome: "DENIED" }),
      expect.objectContaining({ action: "CATEGORY_UPDATE", outcome: "DENIED" }),
      expect.objectContaining({ action: "CATEGORY_DELETE", outcome: "ALLOWED" }),
    ]));
    expect(JSON.stringify(events)).not.toContain("Legal Records");
    expect(JSON.stringify(events)).not.toContain("Project Alpha");
  });
});
