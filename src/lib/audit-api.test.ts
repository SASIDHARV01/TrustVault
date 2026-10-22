import { describe, expect, it } from "vitest";

import {
  adminActivityQuerySchema,
  documentActivityQuerySchema,
} from "./audit-api";

describe("audit activity query validation", () => {
  it("applies bounded pagination and strict action filters", () => {
    expect(documentActivityQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
    });
    expect(
      documentActivityQuerySchema.safeParse({ limit: "51" }).success,
    ).toBe(false);
    expect(
      documentActivityQuerySchema.safeParse({ action: "SECRET_EXPORT" }).success,
    ).toBe(false);
  });

  it("allows administrator actor/document filters but rejects unknown fields", () => {
    expect(
      adminActivityQuerySchema.safeParse({ actorId: "actor-1", limit: "10" })
        .success,
    ).toBe(true);
    expect(adminActivityQuerySchema.safeParse({ password: "secret" }).success).toBe(
      false,
    );
  });
});

