import { describe, expect, it } from "vitest";

import {
  createDocumentSchema,
  documentIdSchema,
  documentListQuerySchema,
  updateDocumentSchema,
} from "./document-api";

describe("document API validation", () => {
  it("normalizes safe list defaults and bounded pagination", () => {
    expect(documentListQuerySchema.parse({})).toEqual({
      state: "ACTIVE",
      page: 1,
      limit: 20,
    });
    expect(
      documentListQuerySchema.parse({ q: "  salary  ", page: "2", limit: "50" }),
    ).toEqual({ state: "ACTIVE", q: "salary", page: 2, limit: 50 });
    expect(documentListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });

  it("rejects unknown query parameters", () => {
    expect(documentListQuerySchema.safeParse({ ownerId: "someone-else" }).success).toBe(
      false,
    );
  });

  it("accepts opaque application IDs but rejects path-like values", () => {
    expect(documentIdSchema.safeParse("doc_01-safe-ID").success).toBe(true);
    expect(documentIdSchema.safeParse("../private/file").success).toBe(false);
  });

  it("prevents ownership and state mass assignment during creation", () => {
    expect(
      createDocumentSchema.safeParse({
        name: "Salary Letter.pdf",
        ownerId: "administrator",
      }).success,
    ).toBe(false);
    expect(
      createDocumentSchema.safeParse({
        name: "Salary Letter.pdf",
        state: "DELETED",
      }).success,
    ).toBe(false);
  });

  it("requires at least one supported metadata update", () => {
    expect(updateDocumentSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentSchema.safeParse({ name: "Updated name" }).success).toBe(
      true,
    );
    expect(updateDocumentSchema.safeParse({ ownerId: "attacker" }).success).toBe(
      false,
    );
  });
});

