import { describe, expect, it } from "vitest";

import { createCategoryApiHandlers } from "./category-api-handlers";
import { CategoryServiceError } from "./category-service";

const actor = { id: "member-1", role: "MEMBER" as const };
const category = {
  id: "category-1",
  name: "Finance",
  activeDocumentCount: 2,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => actor,
    trustedMutationOrigin: () => true,
    listCategories: async () => [category],
    createCategory: async () => category,
    updateCategory: async () => category,
    deleteCategory: async () => category,
    ...overrides,
  };
}

function request(method = "GET", body?: unknown, origin = "https://trustvault.test") {
  return new Request("https://trustvault.test/api/categories/category-1", {
    method,
    headers: body ? { "content-type": "application/json", origin } : { origin },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("category API HTTP boundary", () => {
  it("requires authentication and returns private list responses", async () => {
    const unauthenticated = createCategoryApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const authenticated = createCategoryApiHandlers(dependencies());
    const denied = await unauthenticated.list();
    const allowed = await authenticated.list();

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
    expect(allowed.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects untrusted origins and category mass assignment", async () => {
    let called = false;
    const handlers = createCategoryApiHandlers(dependencies({
      createCategory: async () => {
        called = true;
        return category;
      },
    }));
    const untrustedHandlers = createCategoryApiHandlers(dependencies({
      trustedMutationOrigin: () => false,
      createCategory: async () => {
        called = true;
        return category;
      },
    }));
    const untrusted = await untrustedHandlers.create(
      request("POST", { name: "Finance" }, "https://evil.test"),
    );
    const extraField = await handlers.create(
      request("POST", { name: "Finance", ownerId: "admin" }),
    );

    expect(untrusted.status).toBe(403);
    expect(extraField.status).toBe(400);
    expect(called).toBe(false);
  });

  it("normalizes names before sending them to the service", async () => {
    let received: { name: string } | undefined;
    const handlers = createCategoryApiHandlers(dependencies({
      createCategory: async (_actor: unknown, input: { name: string }) => {
        received = input;
        return category;
      },
    }));
    const response = await handlers.create(
      request("POST", { name: "  Project　 Alpha  " }),
    );

    expect(response.status).toBe(201);
    expect(received).toEqual({ name: "Project Alpha" });
  });

  it("makes malformed and inaccessible category identifiers indistinguishable", async () => {
    const handlers = createCategoryApiHandlers(dependencies({
      updateCategory: async () => {
        throw new CategoryServiceError("CATEGORY_NOT_FOUND");
      },
    }));
    const malformed = await handlers.update(request("PATCH", { name: "Legal" }), "../private");
    const inaccessible = await handlers.update(request("PATCH", { name: "Legal" }), "category-1");

    expect(malformed.status).toBe(404);
    expect(inaccessible.status).toBe(404);
    expect(await malformed.json()).toEqual(await inaccessible.json());
  });

  it("returns a stable conflict for normalized duplicate names", async () => {
    const handlers = createCategoryApiHandlers(dependencies({
      createCategory: async () => {
        throw new CategoryServiceError("CATEGORY_ALREADY_EXISTS");
      },
    }));
    const response = await handlers.create(request("POST", { name: "finance" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CATEGORY_ALREADY_EXISTS" },
    });
  });
});
