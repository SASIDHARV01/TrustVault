import { describe, expect, it } from "vitest";

import { createDocumentContentApiHandlers } from "./document-content-api-handlers";
import { DocumentContentServiceError } from "./document-content-service";

const actor = { id: "owner-1", role: "MEMBER" as const };
const version = {
  id: "version-1",
  documentId: "document-1",
  versionNumber: 1,
  originalFilename: "Report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 8,
  sha256: "a".repeat(64),
  storageState: "READY" as const,
  createdAt: "2026-10-22T00:00:00.000Z",
  createdBy: { id: actor.id, name: "Owner", email: "owner@trustvault.local" },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getActor: async () => actor,
    trustedMutationOrigin: () => true,
    createVersion: async () => version,
    listVersions: async () => [version],
    getContent: async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from(Buffer.from("%PDF-1")));
          controller.close();
        },
      }),
      filename: "Report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
    }),
    ...overrides,
  };
}

function uploadRequest(file: File, origin = "https://trustvault.test") {
  const form = new FormData();
  form.set("file", file);
  return new Request("https://trustvault.test/api/documents/document-1/versions", {
    method: "POST",
    headers: { origin },
    body: form,
  });
}

describe("document content API boundary", () => {
  it("requires authentication and a trusted upload origin", async () => {
    const unauthenticated = createDocumentContentApiHandlers(
      dependencies({ getActor: async () => null }),
    );
    const untrusted = createDocumentContentApiHandlers(
      dependencies({ trustedMutationOrigin: () => false }),
    );
    const file = new File(["%PDF-1"], "Report.pdf", { type: "application/pdf" });

    await expect(unauthenticated.upload(uploadRequest(file), "document-1")).resolves.toMatchObject({ status: 401 });
    await expect(untrusted.upload(uploadRequest(file, "https://evil.test"), "document-1")).resolves.toMatchObject({ status: 403 });
  });

  it("accepts exactly one multipart file and never exposes a storage key", async () => {
    let candidate: { originalFilename: string; declaredMimeType: string; bytes: Uint8Array } | undefined;
    const handlers = createDocumentContentApiHandlers(
      dependencies({
        createVersion: async (_actor: unknown, _documentId: unknown, value: typeof candidate) => {
          candidate = value;
          return version;
        },
      }),
    );
    const response = await handlers.upload(
      uploadRequest(new File(["%PDF-1"], "Report.pdf", { type: "application/pdf" })),
      "document-1",
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(201);
    expect(candidate).toMatchObject({ originalFilename: "Report.pdf", declaredMimeType: "application/pdf" });
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("r2");
  });

  it("uses indistinguishable not-found responses for denied content", async () => {
    const handlers = createDocumentContentApiHandlers(
      dependencies({
        getContent: async () => {
          throw new DocumentContentServiceError("VERSION_NOT_FOUND");
        },
      }),
    );
    const response = await handlers.getContent(
      new Request("https://trustvault.test/api/documents/document-1/versions/version-1/content"),
      "document-1",
      "version-1",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_NOT_FOUND" } });
  });

  it("streams protected bytes with no-store, nosniff, and safe disposition headers", async () => {
    let receivedReason: string | null | undefined;
    const handlers = createDocumentContentApiHandlers(
      dependencies({
        getContent: async (
          _actor: unknown,
          _documentId: unknown,
          _versionId: unknown,
          _disposition: unknown,
          reason: string | null,
        ) => {
          receivedReason = reason;
          return dependencies().getContent();
        },
      }),
    );
    const response = await handlers.getContent(
      new Request("https://trustvault.test/api/documents/document-1/versions/version-1/content?disposition=attachment", {
        headers: { "x-trustvault-override-reason": "Incident investigation 42" },
      }),
      "document-1",
      "version-1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(receivedReason).toBe("Incident investigation 42");
  });
});
