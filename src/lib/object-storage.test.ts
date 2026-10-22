import { describe, expect, it } from "vitest";

import {
  createAuditCheckpointObjectKey,
  createDocumentObjectKey,
  parseObjectStorageKey,
} from "./object-storage";

describe("object storage keys", () => {
  it("creates an unguessable document key without user-controlled names", () => {
    const key = createDocumentObjectKey(
      () => "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(key).toBe(
      "documents/12/123e4567-e89b-42d3-a456-426614174000",
    );
  });

  it("uses a separate unguessable namespace for audit checkpoints", () => {
    const key = createAuditCheckpointObjectKey(
      () => "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(key).toBe(
      "audit-checkpoints/12/123e4567-e89b-42d3-a456-426614174000",
    );
  });

  it.each([
    "",
    "/documents/file",
    "documents/../secret",
    "documents//file",
    "documents/file name",
    `documents/${"a".repeat(503)}`,
  ])("rejects unsafe object key %j", (value) => {
    expect(() => parseObjectStorageKey(value)).toThrowError(
      "INVALID_OBJECT_KEY",
    );
  });
});
