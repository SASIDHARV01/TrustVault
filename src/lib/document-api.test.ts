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
      scope: "all",
      state: "ACTIVE",
      sort: "createdAt",
      order: "desc",
      page: 1,
      limit: 20,
    });
    expect(
      documentListQuerySchema.parse({ q: "  salary  ", page: "2", limit: "50" }),
    ).toEqual({
      scope: "all",
      state: "ACTIVE",
      q: "salary",
      sort: "createdAt",
      order: "desc",
      page: 2,
      limit: 50,
    });
    expect(documentListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });

  it("accepts allowlisted search filters and rejects invalid ranges or fields", () => {
    expect(documentListQuerySchema.safeParse({
      ownerId: "someone-else",
      category: "Finance",
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdTo: "2026-12-31T23:59:59.999Z",
      sort: "name",
      order: "asc",
    }).success).toBe(true);
    expect(documentListQuerySchema.safeParse({
      createdFrom: "2027-01-01T00:00:00.000Z",
      createdTo: "2026-01-01T00:00:00.000Z",
    }).success).toBe(false);
    expect(documentListQuerySchema.safeParse({ role: "ADMIN" }).success).toBe(false);
    expect(documentListQuerySchema.safeParse({ scope: "owned" }).success).toBe(true);
    expect(documentListQuerySchema.safeParse({ scope: "shared" }).success).toBe(true);
    expect(documentListQuerySchema.safeParse({ scope: "global" }).success).toBe(false);
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

