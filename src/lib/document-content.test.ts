import { describe, expect, it } from "vitest";

import {
  contentDisposition,
  MAXIMUM_DOCUMENT_BYTES,
  validateDocumentUpload,
} from "./document-content";

const pdf = Uint8Array.from(Buffer.from("%PDF-1.7\nsecure document"));
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]);

describe("document upload validation", () => {
  it.each([
    ["Report.pdf", "application/pdf", pdf],
    ["Evidence.png", "image/png", png],
    ["Photo.jpeg", "image/jpeg", jpeg],
  ])("accepts supported bytes for %s", (filename, mimeType, bytes) => {
    const result = validateDocumentUpload({
      originalFilename: filename,
      declaredMimeType: mimeType,
      bytes,
    });

    expect(result).toMatchObject({
      originalFilename: filename,
      mimeType,
      sizeBytes: bytes.byteLength,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["empty", { originalFilename: "empty.pdf", declaredMimeType: "application/pdf", bytes: new Uint8Array() }, "EMPTY_FILE"],
    ["oversized", { originalFilename: "large.pdf", declaredMimeType: "application/pdf", bytes: new Uint8Array(MAXIMUM_DOCUMENT_BYTES + 1) }, "FILE_TOO_LARGE"],
    ["traversal", { originalFilename: "../secret.pdf", declaredMimeType: "application/pdf", bytes: pdf }, "UNSAFE_FILENAME"],
    ["double extension", { originalFilename: "invoice.exe.pdf", declaredMimeType: "application/pdf", bytes: pdf }, "UNSAFE_FILENAME"],
    ["unsupported", { originalFilename: "script.exe", declaredMimeType: "application/octet-stream", bytes: Uint8Array.from([1, 2, 3]) }, "UNSUPPORTED_FILE_TYPE"],
    ["fake MIME", { originalFilename: "fake.pdf", declaredMimeType: "application/pdf", bytes: png }, "FILE_TYPE_MISMATCH"],
    ["fake extension", { originalFilename: "fake.png", declaredMimeType: "application/pdf", bytes: pdf }, "FILE_TYPE_MISMATCH"],
  ])("rejects %s uploads", (_label, candidate, code) => {
    expect(() => validateDocumentUpload(candidate)).toThrowError(code);
  });

  it("builds a safe standards-compatible disposition header", () => {
    expect(contentDisposition("attachment", "Résumé.pdf")).toBe(
      "attachment; filename=\"R_sum_.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf",
    );
  });
});
