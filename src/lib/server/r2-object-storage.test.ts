import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  parseObjectStorageKey,
  type ObjectStorageKey,
} from "@/lib/object-storage";
import { R2ObjectStorage } from "./r2-object-storage";

const key = parseObjectStorageKey(
  "documents/12/123e4567-e89b-42d3-a456-426614174000",
);
const sha256 = "b".repeat(64);

function clientWith(send: ReturnType<typeof vi.fn>) {
  return { send } as unknown as S3Client;
}

describe("Cloudflare R2 object storage adapter", () => {
  it("uploads to the configured private bucket without an ACL or public URL", async () => {
    const send = vi.fn().mockResolvedValue({ ETag: '"etag-value"' });
    const storage = new R2ObjectStorage(clientWith(send), "trustvault-documents");
    const body = Uint8Array.from([1, 2, 3]);

    await expect(
      storage.put({ key, body, contentType: "application/pdf", sha256 }),
    ).resolves.toEqual({
      contentType: "application/pdf",
      contentLength: 3,
      etag: "etag-value",
      sha256,
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "trustvault-documents",
      Key: key,
      Body: body,
      ContentLength: 3,
      ContentType: "application/pdf",
      CacheControl: "private, no-store",
      Metadata: { sha256 },
    });
    expect(command.input).not.toHaveProperty("ACL");
  });

  it("returns an object as a web stream without creating a signed URL", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([4, 5, 6]));
        controller.close();
      },
    });
    const send = vi.fn().mockResolvedValue({
      Body: { transformToWebStream: () => body },
      ContentType: "application/pdf",
      ContentLength: 3,
      ETag: '"read-etag"',
      Metadata: { sha256 },
    });
    const storage = new R2ObjectStorage(clientWith(send), "trustvault-documents");

    const result = await storage.get(key);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(
      Uint8Array.from([4, 5, 6]),
    );
    expect(result).toMatchObject({
      contentType: "application/pdf",
      contentLength: 3,
      etag: "read-etag",
      sha256,
    });
  });

  it("maps provider 404 responses to a stable storage error", async () => {
    const send = vi.fn().mockRejectedValue({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    const storage = new R2ObjectStorage(clientWith(send), "trustvault-documents");

    await expect(storage.head(key)).rejects.toMatchObject({
      name: "ObjectStorageError",
      code: "OBJECT_NOT_FOUND",
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("revalidates branded keys before sending them to R2", async () => {
    const send = vi.fn();
    const storage = new R2ObjectStorage(clientWith(send), "trustvault-documents");

    await expect(
      storage.head("documents/../secret" as ObjectStorageKey),
    ).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
    expect(send).not.toHaveBeenCalled();
  });

  it("uses an idempotent object delete command", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new R2ObjectStorage(clientWith(send), "trustvault-documents");
    await storage.delete(key);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "trustvault-documents",
      Key: key,
    });
  });
});
