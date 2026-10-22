import { describe, expect, it } from "vitest";

import {
  parseObjectStorageKey,
} from "@/lib/object-storage";
import { InMemoryObjectStorage } from "./in-memory-object-storage";

const key = parseObjectStorageKey(
  "documents/12/123e4567-e89b-42d3-a456-426614174000",
);
const sha256 = "a".repeat(64);

describe("in-memory object storage contract", () => {
  it("stores defensive byte copies and returns safe metadata", async () => {
    const storage = new InMemoryObjectStorage();
    const body = Uint8Array.from([1, 2, 3]);
    await storage.put({ key, body, contentType: "application/pdf", sha256 });
    body[0] = 9;

    const object = await storage.get(key);
    expect(new Uint8Array(await new Response(object.body).arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    await expect(storage.head(key)).resolves.toEqual({
      contentType: "application/pdf",
      contentLength: 3,
      etag: null,
      sha256,
    });
  });

  it("supports idempotent deletion and a stable not-found error", async () => {
    const storage = new InMemoryObjectStorage();
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toMatchObject({
      code: "OBJECT_NOT_FOUND",
    });
  });

  it("rejects empty or unsigned objects", async () => {
    const storage = new InMemoryObjectStorage();
    await expect(
      storage.put({
        key,
        body: new Uint8Array(),
        contentType: "application/pdf",
        sha256,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OBJECT" });
  });
});
