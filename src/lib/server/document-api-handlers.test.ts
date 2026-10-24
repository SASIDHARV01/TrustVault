import { describe, expect, it, vi } from "vitest";

import { createDocumentApiHandlers } from "./document-api-handlers";
import { DocumentServiceError } from "./document-service";

const actor = { id: "member-1", role: "MEMBER" as const };
const document = {
  id: "document-1",
  name: "Salary Letter.pdf",
  description: null,
  state: "ACTIVE" as const,
  access: "OWNER" as const,
  owner: { id: actor.id, name: "Member One", email: "member@trustvault.local" },
  category: null,
  deletedAt: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => actor,
    trustedMutationOrigin: () => true,
    listDocuments: async () => ({
      documents: [document],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
    createDocument: async () => document,
    getDocument: async () => document,
    updateDocument: async () => document,
    deleteDocument: async () => ({ ...document, state: "DELETED" as const }),
    restoreDocument: async () => document,
    ...overrides,
  };
}

function jsonRequest(method: string, body: unknown, origin = "https://trustvault.test") {
  return new Request("https://trustvault.test/api/documents/document-1", {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("document API HTTP boundary", () => {
  it("requires an authenticated database-backed actor", async () => {
    const handlers = createDocumentApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const result = await handlers.list(
      new Request("https://trustvault.test/api/documents"),
    );

    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required.",
      },
    });
  });

  it("validates list queries and disables response caching", async () => {
    const listDocuments = vi.fn(dependencies().listDocuments);
    const handlers = createDocumentApiHandlers(dependencies({ listDocuments }));
    const invalid = await handlers.list(
      new Request("https://trustvault.test/api/documents?limit=1000"),
    );
    const valid = await handlers.list(
      new Request("https://trustvault.test/api/documents?q=salary&scope=shared"),
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toBe("private, no-store");
    expect(valid.headers.get("vary")).toBe("Cookie");
    expect(valid.headers.get("x-request-id")).toBeTruthy();
    expect(listDocuments).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ q: "salary", scope: "shared" }),
    );
  });

  it("rejects cross-origin document mutations", async () => {
    const handlers = createDocumentApiHandlers(
      dependencies({ trustedMutationOrigin: () => false }),
    );
    const result = await handlers.create(
      jsonRequest("POST", { name: "Salary Letter.pdf" }, "https://evil.test"),
    );

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "UNTRUSTED_ORIGIN" },
    });
  });

  it("rejects mass-assignment fields before the service runs", async () => {
    let serviceCalled = false;
    const handlers = createDocumentApiHandlers(
      dependencies({
        createDocument: async () => {
          serviceCalled = true;
          return document;
        },
      }),
    );
    const result = await handlers.create(
      jsonRequest("POST", { name: "Salary Letter.pdf", ownerId: "admin" }),
    );

    expect(result.status).toBe(400);
    expect(serviceCalled).toBe(false);
  });

  it("rejects JSON bodies larger than the streaming limit", async () => {
    let serviceCalled = false;
    const handlers = createDocumentApiHandlers(
      dependencies({
        createDocument: async () => {
          serviceCalled = true;
          return document;
        },
      }),
    );
    const result = await handlers.create(
      jsonRequest("POST", { name: "x".repeat(70 * 1024) }),
    );

    expect(result.status).toBe(400);
    expect(serviceCalled).toBe(false);
  });

  it("makes invalid, missing, and inaccessible identifiers indistinguishable", async () => {
    const handlers = createDocumentApiHandlers(
      dependencies({
        getDocument: async () => {
          throw new DocumentServiceError("DOCUMENT_NOT_FOUND");
        },
      }),
    );
    const invalid = await handlers.get(
      new Request("https://trustvault.test/api/documents/invalid"),
      "../invalid",
    );
    const inaccessible = await handlers.get(
      new Request("https://trustvault.test/api/documents/document-1"),
      "document-1",
    );

    expect(invalid.status).toBe(404);
    expect(inaccessible.status).toBe(404);
    expect(await invalid.json()).toEqual(await inaccessible.json());
  });

  it("does not expose categories owned by another user", async () => {
    const handlers = createDocumentApiHandlers(
      dependencies({
        createDocument: async () => {
          throw new DocumentServiceError("INVALID_CATEGORY");
        },
      }),
    );
    const result = await handlers.create(
      jsonRequest("POST", { name: "Salary Letter.pdf", categoryId: "private" }),
    );

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "INVALID_CATEGORY" },
    });
  });
});

