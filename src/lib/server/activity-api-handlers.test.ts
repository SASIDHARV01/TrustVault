import { describe, expect, it } from "vitest";

import { createActivityApiHandlers } from "./activity-api-handlers";
import { ActivityServiceError } from "./activity-service";

const actor = { id: "owner-1", role: "MEMBER" as const };
const emptyActivity = {
  events: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => actor,
    trustedMutationOrigin: () => true,
    listDocument: async () => emptyActivity,
    listSystem: async () => emptyActivity,
    verifySystem: async () => ({
      valid: true as const,
      eventCount: 0,
      headHash: "0".repeat(64),
    }),
    ...overrides,
  };
}

describe("activity API HTTP boundary", () => {
  it("requires authentication", async () => {
    const handlers = createActivityApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const result = await handlers.listSystem(
      new Request("https://trustvault.test/api/admin/activity"),
    );
    expect(result.status).toBe(401);
  });

  it("rejects unbounded and unknown activity filters", async () => {
    const handlers = createActivityApiHandlers(dependencies());
    const result = await handlers.listDocument(
      new Request(
        "https://trustvault.test/api/documents/document-1/activity?limit=500&secret=x",
      ),
      "document-1",
    );
    expect(result.status).toBe(400);
  });

  it("maps inaccessible documents and non-admin system access safely", async () => {
    const hidden = createActivityApiHandlers(
      dependencies({
        listDocument: async () => {
          throw new ActivityServiceError("DOCUMENT_NOT_FOUND");
        },
      }),
    );
    const forbidden = createActivityApiHandlers(
      dependencies({
        listSystem: async () => {
          throw new ActivityServiceError("ADMIN_REQUIRED");
        },
      }),
    );
    const documentResult = await hidden.listDocument(
      new Request("https://trustvault.test/api/documents/document-1/activity"),
      "document-1",
    );
    const systemResult = await forbidden.listSystem(
      new Request("https://trustvault.test/api/admin/activity"),
    );
    expect(documentResult.status).toBe(404);
    expect(systemResult.status).toBe(403);
  });

  it("requires trusted origin for integrity verification", async () => {
    const handlers = createActivityApiHandlers(
      dependencies({ trustedMutationOrigin: () => false }),
    );
    const result = await handlers.verifySystem(
      new Request("https://trustvault.test/api/admin/audit/verify", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
    );
    expect(result.status).toBe(403);
  });

  it("returns private request-correlated activity responses", async () => {
    const handlers = createActivityApiHandlers(dependencies());
    const result = await handlers.listDocument(
      new Request("https://trustvault.test/api/documents/document-1/activity"),
      "document-1",
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-request-id")).toBeTruthy();
  });
});

