import { describe, expect, it } from "vitest";

import { createAuditCheckpointApiHandlers } from "./audit-checkpoint-api-handlers";
import { AuditCheckpointServiceError } from "./audit-checkpoint-service";

const admin = { id: "admin-1", role: "ADMIN" as const };
const checkpoint = {
  id: "checkpoint-1",
  throughEventId: "42",
  chainHash: "a".repeat(64),
  createdAt: "2026-10-22T00:00:00.000Z",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => admin,
    trustedMutationOrigin: () => true,
    createCheckpoint: async () => checkpoint,
    listCheckpoints: async () => [checkpoint],
    ...overrides,
  };
}

describe("audit checkpoint API boundary", () => {
  it("requires authentication and a trusted origin", async () => {
    const unauthenticated = createAuditCheckpointApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const untrusted = createAuditCheckpointApiHandlers(
      dependencies({ trustedMutationOrigin: () => false }),
    );
    const request = new Request("https://trustvault.test/api/admin/audit/checkpoints", {
      method: "POST",
      headers: { origin: "https://trustvault.test" },
    });

    await expect(unauthenticated.create(request)).resolves.toMatchObject({ status: 401 });
    await expect(untrusted.create(request)).resolves.toMatchObject({ status: 403 });
  });

  it("returns only public checkpoint evidence", async () => {
    const handlers = createAuditCheckpointApiHandlers(dependencies());
    const response = await handlers.create(
      new Request("https://trustvault.test/api/admin/audit/checkpoints", {
        method: "POST",
        headers: { origin: "https://trustvault.test" },
      }),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(201);
    expect(serialized).toContain("checkpoint-1");
    expect(serialized).not.toContain("storageKey");
  });

  it("maps a tampered chain to a safe conflict response", async () => {
    const handlers = createAuditCheckpointApiHandlers(
      dependencies({
        createCheckpoint: async () => {
          throw new AuditCheckpointServiceError("CHAIN_INVALID");
        },
      }),
    );
    const response = await handlers.create(
      new Request("https://trustvault.test/api/admin/audit/checkpoints", {
        method: "POST",
        headers: { origin: "https://trustvault.test" },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CHAIN_INVALID" } });
  });
});
