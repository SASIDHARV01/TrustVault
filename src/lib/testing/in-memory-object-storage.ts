import {
  ObjectStorageError,
  type ObjectStorage,
  type ObjectStorageKey,
  type PutStoredObjectInput,
  type StoredObjectMetadata,
  validatePutStoredObjectInput,
} from "@/lib/object-storage";

type MemoryObject = StoredObjectMetadata & { bytes: Uint8Array };

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<ObjectStorageKey, MemoryObject>();

  async put(input: PutStoredObjectInput) {
    validatePutStoredObjectInput(input);
    const metadata = {
      contentType: input.contentType,
      contentLength: input.body.byteLength,
      etag: null,
      sha256: input.sha256,
    } satisfies StoredObjectMetadata;
    this.objects.set(input.key, {
      ...metadata,
      bytes: Uint8Array.from(input.body),
    });
    return metadata;
  }

  async get(key: ObjectStorageKey) {
    const object = this.requireObject(key);
    const bytes = Uint8Array.from(object.bytes);
    return {
      contentType: object.contentType,
      contentLength: object.contentLength,
      etag: object.etag,
      sha256: object.sha256,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }

  async head(key: ObjectStorageKey) {
    const object = this.requireObject(key);
    return {
      contentType: object.contentType,
      contentLength: object.contentLength,
      etag: object.etag,
      sha256: object.sha256,
    };
  }

  async delete(key: ObjectStorageKey) {
    this.objects.delete(key);
  }

  has(key: ObjectStorageKey) {
    return this.objects.has(key);
  }

  private requireObject(key: ObjectStorageKey) {
    const object = this.objects.get(key);
    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND");
    return object;
  }
}
