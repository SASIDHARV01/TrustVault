import { describe, expect, it } from "vitest";

import { createPermissionApiHandlers } from "./permission-api-handlers";
import { PermissionServiceError } from "./permission-service";

const actor = { id: "owner-1", role: "MEMBER" as const };
const recipient = {
  id: "reader-1",
  name: "Reader One",
  email: "reader@trustvault.local",
};
const grant = {
  id: "grant-1",
  documentId: "document-1",
  accessLevel: "READ" as const,
  status: "ACTIVE" as const,
  recipient,
  grantedBy: { id: actor.id, name: "Owner One" },
  revokedBy: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  revokedAt: null,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => actor,
    trustedMutationOrigin: () => true,
    lookupRecipient: async () => recipient,
    listGrants: async () => ({ grants: [grant] }),
    createGrant: async () => grant,
    updateGrant: async () => ({ ...grant, accessLevel: "EDIT" as const }),
    revokeGrant: async () => ({
      ...grant,
      status: "REVOKED" as const,
      revokedAt: "2026-10-22T01:00:00.000Z",
    }),
    ...overrides,
  };
}

function jsonRequest(method: string, body: unknown) {
  return new Request("https://trustvault.test/api/documents/document-1/grants", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://trustvault.test",
    },
    body: JSON.stringify(body),
  });
}

describe("permission API HTTP boundary", () => {
  it("requires authentication before recipient lookup", async () => {
    const handlers = createPermissionApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const result = await handlers.lookupRecipient(
      new Request(
        "https://trustvault.test/api/recipients?email=reader%40trustvault.local",
      ),
    );

    expect(result.status).toBe(401);
  });

  it("requires exact-email recipient lookup and returns no-store metadata", async () => {
    let lookupCalled = false;
    const handlers = createPermissionApiHandlers(
      dependencies({
        lookupRecipient: async () => {
          lookupCalled = true;
          return recipient;
        },
      }),
    );
    const invalid = await handlers.lookupRecipient(
      new Request("https://trustvault.test/api/recipients?q=reader"),
    );
    const valid = await handlers.lookupRecipient(
      new Request(
        "https://trustvault.test/api/recipients?email=reader%40trustvault.local",
      ),
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(lookupCalled).toBe(true);
    expect(valid.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects cross-origin grant mutations", async () => {
    const handlers = createPermissionApiHandlers(
      dependencies({ trustedMutationOrigin: () => false }),
    );
    const result = await handlers.createGrant(
      jsonRequest("POST", {
        recipientEmail: recipient.email,
        accessLevel: "READ",
      }),
      "document-1",
    );

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "UNTRUSTED_ORIGIN" },
    });
  });

  it("rejects grant mass assignment before calling the service", async () => {
    let serviceCalled = false;
    const handlers = createPermissionApiHandlers(
      dependencies({
        createGrant: async () => {
          serviceCalled = true;
          return grant;
        },
      }),
    );
    const result = await handlers.createGrant(
      jsonRequest("POST", {
        recipientEmail: recipient.email,
        accessLevel: "READ",
        grantedById: "administrator",
      }),
      "document-1",
    );

    expect(result.status).toBe(400);
    expect(serviceCalled).toBe(false);
  });

  it("maps inaccessible documents and duplicate grants safely", async () => {
    const inaccessible = createPermissionApiHandlers(
      dependencies({
        listGrants: async () => {
          throw new PermissionServiceError("DOCUMENT_NOT_FOUND");
        },
      }),
    );
    const duplicate = createPermissionApiHandlers(
      dependencies({
        createGrant: async () => {
          throw new PermissionServiceError("ACTIVE_GRANT_EXISTS");
        },
      }),
    );

    const hidden = await inaccessible.listGrants(
      new Request("https://trustvault.test/api/documents/document-1/grants"),
      "document-1",
    );
    const conflict = await duplicate.createGrant(
      jsonRequest("POST", {
        recipientEmail: recipient.email,
        accessLevel: "READ",
      }),
      "document-1",
    );

    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toMatchObject({
      error: { code: "DOCUMENT_NOT_FOUND" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "ACTIVE_GRANT_EXISTS" },
    });
  });
});

