import "server-only";

import { randomUUID } from "node:crypto";

const objectKeyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9/_-]{0,510}[A-Za-z0-9])?$/;

export type ObjectStorageKey = string & { readonly __objectStorageKey: unique symbol };

export type StoredObjectMetadata = {
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  sha256: string | null;
};

export type StoredObject = StoredObjectMetadata & {
  body: ReadableStream<Uint8Array>;
};

export type PutStoredObjectInput = {
  key: ObjectStorageKey;
  body: Uint8Array;
  contentType: string;
  sha256: string;
};

export interface ObjectStorage {
  put(input: PutStoredObjectInput): Promise<StoredObjectMetadata>;
  get(key: ObjectStorageKey): Promise<StoredObject>;
  head(key: ObjectStorageKey): Promise<StoredObjectMetadata>;
  delete(key: ObjectStorageKey): Promise<void>;
}

export class ObjectStorageError extends Error {
  constructor(
    readonly code:
      | "INVALID_OBJECT_KEY"
      | "INVALID_OBJECT"
      | "OBJECT_NOT_FOUND"
      | "PROVIDER_ERROR",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ObjectStorageError";
  }
}

export function parseObjectStorageKey(value: string): ObjectStorageKey {
  if (
    !objectKeyPattern.test(value) ||
    value.includes("..") ||
    value.includes("//")
  ) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY");
  }
  return value as ObjectStorageKey;
}

export function createDocumentObjectKey(
  createId: () => string = randomUUID,
): ObjectStorageKey {
  const id = createId();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  ) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY");
  }
  return parseObjectStorageKey(`documents/${id.slice(0, 2)}/${id}`);
}

export function createAuditCheckpointObjectKey(
  createId: () => string = randomUUID,
): ObjectStorageKey {
  const id = createId();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  ) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY");
  }
  return parseObjectStorageKey(`audit-checkpoints/${id.slice(0, 2)}/${id}`);
}

export function validatePutStoredObjectInput(input: PutStoredObjectInput) {
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new ObjectStorageError("INVALID_OBJECT");
  }
  if (!input.contentType || input.contentType.length > 128) {
    throw new ObjectStorageError("INVALID_OBJECT");
  }
  if (input.body.byteLength < 1) {
    throw new ObjectStorageError("INVALID_OBJECT");
  }
}
