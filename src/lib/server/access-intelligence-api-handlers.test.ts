import { describe, expect, it, vi } from "vitest";

import {
  createAccessIntelligenceApiHandlers,
} from "./access-intelligence-api-handlers";
import { AccessIntelligenceServiceError } from "./access-intelligence-service";

const actor = { id: "admin-1", role: "ADMIN" as const };
const emptyResult = {
  grants: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

describe("access intelligence API HTTP boundary", () => {
  it("requires authentication", async () => {
    const handlers = createAccessIntelligenceApiHandlers({
      getActor: async () => null,
    });
    const result = await handlers.list(
      new Request("https://trustvault.test/api/admin/access"),
    );
    expect(result.status).toBe(401);
  });

  it("rejects unknown, invalid, and unbounded filters", async () => {
    const handlers = createAccessIntelligenceApiHandlers({
      getActor: async () => actor,
      list: async () => emptyResult,
    });
    const result = await handlers.list(
      new Request(
        "https://trustvault.test/api/admin/access?status=EXPIRED&limit=500&secret=x",
      ),
    );
    expect(result.status).toBe(400);
  });

  it("maps non-admin access to a safe forbidden response", async () => {
    const handlers = createAccessIntelligenceApiHandlers({
      getActor: async () => ({ id: "member-1", role: "MEMBER" }),
      list: async () => {
        throw new AccessIntelligenceServiceError("ADMIN_REQUIRED");
      },
    });
    const result = await handlers.list(
      new Request("https://trustvault.test/api/admin/access"),
    );
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({
      error: { code: "ADMIN_REQUIRED" },
    });
  });

  it("passes validated filters and returns private request-correlated data", async () => {
    const list = vi.fn().mockResolvedValue(emptyResult);
    const handlers = createAccessIntelligenceApiHandlers({
      getActor: async () => actor,
      list,
    });
    const result = await handlers.list(
      new Request(
        "https://trustvault.test/api/admin/access?q=salary&status=REVOKED&accessLevel=READ&page=2&limit=10",
      ),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toBe("Cookie");
    expect(result.headers.get("x-request-id")).toBeTruthy();
    expect(list).toHaveBeenCalledWith(
      actor,
      {
        q: "salary",
        status: "REVOKED",
        accessLevel: "READ",
        page: 2,
        limit: 10,
      },
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });
});
