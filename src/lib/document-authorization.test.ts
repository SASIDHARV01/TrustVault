import { describe, expect, it } from "vitest";

import {
  decideDocumentAuthorization,
  DOCUMENT_ACTIONS,
  isValidAdminOverrideReason,
  type DocumentAction,
  type DocumentAuthorizationContext,
} from "./document-authorization";

const baseContext: DocumentAuthorizationContext = {
  actorId: "unrelated-user",
  systemRole: "MEMBER",
  documentOwnerId: "owner-user",
  documentState: "ACTIVE",
  activeGrant: null,
};

function allowedActions(context: DocumentAuthorizationContext) {
  return DOCUMENT_ACTIONS.filter(
    (action) => decideDocumentAuthorization(action, context).allowed,
  );
}

function expectAllowedActions(
  context: DocumentAuthorizationContext,
  expected: DocumentAction[],
) {
  expect(allowedActions(context)).toEqual(expected);
}

describe("document authorization matrix", () => {
  it("gives an active owner every ordinary document capability", () => {
    expectAllowedActions(
      { ...baseContext, actorId: "owner-user" },
      [
        "DISCOVER",
        "VIEW_METADATA",
        "PREVIEW",
        "DOWNLOAD",
        "UPDATE_METADATA",
        "CREATE_VERSION",
        "DELETE",
        "MANAGE_GRANTS",
        "VIEW_ACTIVITY",
      ],
    );
  });

  it("limits a READ recipient to discovery and read operations", () => {
    expectAllowedActions(
      { ...baseContext, activeGrant: "READ" },
      ["DISCOVER", "VIEW_METADATA", "PREVIEW", "DOWNLOAD"],
    );
  });

  it("adds metadata and version changes for an EDIT recipient", () => {
    expectAllowedActions(
      { ...baseContext, activeGrant: "EDIT" },
      [
        "DISCOVER",
        "VIEW_METADATA",
        "PREVIEW",
        "DOWNLOAD",
        "UPDATE_METADATA",
        "CREATE_VERSION",
      ],
    );
  });

  it("denies every action to an unrelated ordinary user", () => {
    expectAllowedActions(baseContext, []);
  });

  it("limits an administrator without a grant to metadata and activity", () => {
    expectAllowedActions(
      { ...baseContext, systemRole: "ADMIN" },
      ["DISCOVER", "VIEW_METADATA", "VIEW_ACTIVITY"],
    );
  });

  it("allows a reason-bearing administrator content override", () => {
    expectAllowedActions(
      {
        ...baseContext,
        systemRole: "ADMIN",
        adminOverrideReason: "Investigating reported data exposure",
      },
      [
        "DISCOVER",
        "VIEW_METADATA",
        "VIEW_ACTIVITY",
        "ADMIN_OVERRIDE_READ",
      ],
    );
  });

  it("lets an administrator use an independently issued EDIT grant", () => {
    expectAllowedActions(
      { ...baseContext, systemRole: "ADMIN", activeGrant: "EDIT" },
      [
        "DISCOVER",
        "VIEW_METADATA",
        "PREVIEW",
        "DOWNLOAD",
        "UPDATE_METADATA",
        "CREATE_VERSION",
        "VIEW_ACTIVITY",
      ],
    );
  });
});

describe("deleted document authorization", () => {
  const deletedContext = {
    ...baseContext,
    documentState: "DELETED" as const,
  };

  it("lets only the owner inspect, restore, and review a deleted document", () => {
    expectAllowedActions(
      { ...deletedContext, actorId: "owner-user" },
      ["VIEW_METADATA", "RESTORE", "VIEW_ACTIVITY"],
    );
  });

  it("lets an administrator inspect metadata and activity but not restore or read content", () => {
    expectAllowedActions(
      {
        ...deletedContext,
        systemRole: "ADMIN",
        adminOverrideReason: "Investigating reported data exposure",
      },
      ["VIEW_METADATA", "VIEW_ACTIVITY"],
    );
  });

  it.each(["READ", "EDIT"] as const)(
    "revokes effective %s access while the document is deleted",
    (activeGrant) => {
      expectAllowedActions({ ...deletedContext, activeGrant }, []);
    },
  );
});

describe("deny reasons", () => {
  it("distinguishes a weak grant from no active grant", () => {
    expect(
      decideDocumentAuthorization("CREATE_VERSION", {
        ...baseContext,
        activeGrant: "READ",
      }),
    ).toEqual({ allowed: false, reason: "DENY_INSUFFICIENT_GRANT" });

    expect(decideDocumentAuthorization("CREATE_VERSION", baseContext)).toEqual({
      allowed: false,
      reason: "DENY_NO_ACTIVE_GRANT",
    });
  });

  it("requires ownership for destructive and sharing operations", () => {
    expect(
      decideDocumentAuthorization("DELETE", {
        ...baseContext,
        activeGrant: "EDIT",
      }),
    ).toEqual({ allowed: false, reason: "DENY_OWNER_REQUIRED" });
    expect(
      decideDocumentAuthorization("MANAGE_GRANTS", {
        ...baseContext,
        systemRole: "ADMIN",
      }),
    ).toEqual({ allowed: false, reason: "DENY_OWNER_REQUIRED" });
  });

  it("requires administrators to use the explicit override for content", () => {
    expect(
      decideDocumentAuthorization("DOWNLOAD", {
        ...baseContext,
        systemRole: "ADMIN",
      }),
    ).toEqual({ allowed: false, reason: "DENY_ADMIN_OVERRIDE_REQUIRED" });
  });

  it("does not allow restoring an active document", () => {
    expect(
      decideDocumentAuthorization("RESTORE", {
        ...baseContext,
        actorId: "owner-user",
      }),
    ).toEqual({ allowed: false, reason: "DENY_DOCUMENT_ACTIVE" });
  });
});

describe("administrator override reason", () => {
  it.each([undefined, null, "", "short", " ".repeat(20)])(
    "rejects missing or unhelpful reason %s",
    (reason) => {
      expect(isValidAdminOverrideReason(reason)).toBe(false);
    },
  );

  it("accepts a concise operational reason and trims outer whitespace", () => {
    expect(isValidAdminOverrideReason("  Incident review  ")).toBe(true);
  });

  it("rejects a reason larger than the audit-safe limit", () => {
    expect(isValidAdminOverrideReason("x".repeat(501))).toBe(false);
  });

  it("requires the database administrator role even when a reason exists", () => {
    expect(
      decideDocumentAuthorization("ADMIN_OVERRIDE_READ", {
        ...baseContext,
        adminOverrideReason: "Incident review requested by the owner",
      }),
    ).toEqual({ allowed: false, reason: "DENY_ADMIN_REQUIRED" });
  });
});
