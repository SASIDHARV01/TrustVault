import { describe, expect, it } from "vitest";

import {
  createGrantSchema,
  grantIdSchema,
  recipientLookupQuerySchema,
  updateGrantSchema,
} from "./permission-api";

describe("permission API validation", () => {
  it("requires one exact valid email and normalizes its case", () => {
    expect(
      recipientLookupQuerySchema.parse({ email: "  User@Example.COM " }),
    ).toEqual({ email: "user@example.com" });
    expect(recipientLookupQuerySchema.safeParse({ q: "user" }).success).toBe(false);
  });

  it("accepts only READ or EDIT grants", () => {
    expect(
      createGrantSchema.parse({
        recipientEmail: "Reader@Example.com",
        accessLevel: "READ",
      }),
    ).toEqual({ recipientEmail: "reader@example.com", accessLevel: "READ" });
    expect(
      createGrantSchema.safeParse({
        recipientEmail: "reader@example.com",
        accessLevel: "OWNER",
      }).success,
    ).toBe(false);
  });

  it("rejects issuer, revoker, document, and recipient ID mass assignment", () => {
    expect(
      createGrantSchema.safeParse({
        recipientEmail: "reader@example.com",
        accessLevel: "EDIT",
        grantedById: "administrator",
      }).success,
    ).toBe(false);
    expect(
      updateGrantSchema.safeParse({
        accessLevel: "READ",
        recipientId: "someone-else",
        revokedById: "owner",
      }).success,
    ).toBe(false);
  });

  it("rejects path-like grant IDs", () => {
    expect(grantIdSchema.safeParse("grant_01-safe").success).toBe(true);
    expect(grantIdSchema.safeParse("../another/grant").success).toBe(false);
  });
});

