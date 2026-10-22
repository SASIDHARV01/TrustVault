import { createHash } from "node:crypto";

export const MAXIMUM_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAXIMUM_MULTIPART_BYTES = MAXIMUM_DOCUMENT_BYTES + 256 * 1024;

export const supportedDocumentTypes = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
} as const;

export type SupportedDocumentMimeType = keyof typeof supportedDocumentTypes;

export type DocumentUploadCandidate = {
  originalFilename: string;
  declaredMimeType: string;
  bytes: Uint8Array;
  reportedSize?: number;
};

export type ValidatedDocumentUpload = {
  originalFilename: string;
  mimeType: SupportedDocumentMimeType;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

export type DocumentUploadValidationCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSAFE_FILENAME"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TYPE_MISMATCH";

export class DocumentUploadValidationError extends Error {
  constructor(readonly code: DocumentUploadValidationCode) {
    super(code);
    this.name = "DocumentUploadValidationError";
  }
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function detectMimeType(bytes: Uint8Array): SupportedDocumentMimeType | null {
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    hasPrefix(bytes, [0xff, 0xd8, 0xff]) &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    return "image/jpeg";
  }
  return null;
}

function normalizeFilename(value: string) {
  const filename = value.normalize("NFC").trim();
  const containsControlCharacter = [...filename].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (
    filename.length < 1 ||
    filename.length > 255 ||
    filename !== value.normalize("NFC") ||
    containsControlCharacter ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.startsWith(".") ||
    filename.includes("..")
  ) {
    throw new DocumentUploadValidationError("UNSAFE_FILENAME");
  }

  const parts = filename.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DocumentUploadValidationError("UNSAFE_FILENAME");
  }
  return { filename, extension: parts[1].toLowerCase() };
}

export function validateDocumentUpload(
  candidate: DocumentUploadCandidate,
): ValidatedDocumentUpload {
  if (
    candidate.reportedSize !== undefined &&
    candidate.reportedSize > MAXIMUM_DOCUMENT_BYTES
  ) {
    throw new DocumentUploadValidationError("FILE_TOO_LARGE");
  }
  if (candidate.bytes.byteLength < 1) {
    throw new DocumentUploadValidationError("EMPTY_FILE");
  }
  if (candidate.bytes.byteLength > MAXIMUM_DOCUMENT_BYTES) {
    throw new DocumentUploadValidationError("FILE_TOO_LARGE");
  }
  if (
    candidate.reportedSize !== undefined &&
    candidate.reportedSize !== candidate.bytes.byteLength
  ) {
    throw new DocumentUploadValidationError("FILE_TYPE_MISMATCH");
  }

  const { filename, extension } = normalizeFilename(candidate.originalFilename);
  const detectedMimeType = detectMimeType(candidate.bytes);
  if (!detectedMimeType) {
    throw new DocumentUploadValidationError("UNSUPPORTED_FILE_TYPE");
  }
  if (candidate.declaredMimeType.toLowerCase() !== detectedMimeType) {
    throw new DocumentUploadValidationError("FILE_TYPE_MISMATCH");
  }
  if (!(supportedDocumentTypes[detectedMimeType] as readonly string[]).includes(extension)) {
    throw new DocumentUploadValidationError("FILE_TYPE_MISMATCH");
  }

  return {
    originalFilename: filename,
    mimeType: detectedMimeType,
    sizeBytes: candidate.bytes.byteLength,
    sha256: createHash("sha256").update(candidate.bytes).digest("hex"),
    bytes: Uint8Array.from(candidate.bytes),
  };
}

export function parseContentLength(request: Request) {
  const raw = request.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
