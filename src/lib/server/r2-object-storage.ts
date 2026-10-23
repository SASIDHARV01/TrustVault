import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

import {
  ObjectStorageError,
  type ObjectStorage,
  type ObjectStorageKey,
  parseObjectStorageKey,
  type PutStoredObjectInput,
  type StoredObjectMetadata,
  validatePutStoredObjectInput,
} from "@/lib/object-storage";
import { getR2Config, type R2Config } from "@/lib/server/storage-config";

export const R2_REQUEST_TIMEOUT_MS = 15_000;

function providerRequestOptions() {
  return { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) };
}

function cleanEtag(etag: string | undefined) {
  return etag?.replace(/^"|"$/g, "") ?? null;
}

function metadataFrom(
  output: Pick<
    GetObjectCommandOutput | HeadObjectCommandOutput,
    "ContentLength" | "ContentType" | "ETag" | "Metadata"
  >,
): StoredObjectMetadata {
  return {
    contentType: output.ContentType ?? null,
    contentLength: output.ContentLength ?? null,
    etag: cleanEtag(output.ETag),
    sha256: output.Metadata?.sha256 ?? null,
  };
}

function isNotFound(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function translateProviderError(error: unknown): never {
  if (error instanceof ObjectStorageError) throw error;
  if (isNotFound(error)) {
    throw new ObjectStorageError("OBJECT_NOT_FOUND", { cause: error });
  }
  throw new ObjectStorageError("PROVIDER_ERROR", { cause: error });
}

export class R2ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(input: PutStoredObjectInput) {
    validatePutStoredObjectInput(input);
    const key = parseObjectStorageKey(input.key);
    try {
      const output = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.body,
          ContentLength: input.body.byteLength,
          ContentType: input.contentType,
          CacheControl: "private, no-store",
          Metadata: { sha256: input.sha256 },
        }),
        providerRequestOptions(),
      );
      return {
        contentType: input.contentType,
        contentLength: input.body.byteLength,
        etag: cleanEtag(output.ETag),
        sha256: input.sha256,
      };
    } catch (error) {
      return translateProviderError(error);
    }
  }

  async get(key: ObjectStorageKey) {
    const trustedKey = parseObjectStorageKey(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: trustedKey }),
        providerRequestOptions(),
      );
      if (!output.Body) {
        throw new ObjectStorageError("PROVIDER_ERROR");
      }
      return {
        ...metadataFrom(output),
        body: output.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      };
    } catch (error) {
      return translateProviderError(error);
    }
  }

  async head(key: ObjectStorageKey) {
    const trustedKey = parseObjectStorageKey(key);
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: trustedKey }),
        providerRequestOptions(),
      );
      return metadataFrom(output);
    } catch (error) {
      return translateProviderError(error);
    }
  }

  async delete(key: ObjectStorageKey) {
    const trustedKey = parseObjectStorageKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: trustedKey }),
        providerRequestOptions(),
      );
    } catch (error) {
      return translateProviderError(error);
    }
  }
}

export function createR2ObjectStorage(config: R2Config = getR2Config()) {
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return new R2ObjectStorage(client, config.bucket);
}

const globalStorage = globalThis as unknown as {
  trustVaultObjectStorage?: ObjectStorage;
};

export function getObjectStorage() {
  if (!globalStorage.trustVaultObjectStorage) {
    globalStorage.trustVaultObjectStorage = createR2ObjectStorage();
  }
  return globalStorage.trustVaultObjectStorage;
}
