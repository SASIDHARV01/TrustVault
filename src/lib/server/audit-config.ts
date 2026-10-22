import "server-only";

export type AuditKeyring = {
  currentVersion: number;
  keyForVersion: (version: number) => Uint8Array | null;
};

function decodeKey(value: string, version: number) {
  const key = Buffer.from(value, "base64");
  if (key.byteLength < 32) {
    throw new Error(`Audit HMAC key version ${version} must contain at least 32 bytes.`);
  }
  return key;
}

export function createAuditKeyring({
  currentVersion,
  encodedKeys,
}: {
  currentVersion: number;
  encodedKeys: Record<string, string>;
}): AuditKeyring {
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error("AUDIT_HMAC_KEY_VERSION must be a positive integer.");
  }

  const keys = new Map<number, Uint8Array>();
  for (const [rawVersion, encodedKey] of Object.entries(encodedKeys)) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("AUDIT_HMAC_KEYS contains an invalid key version.");
    }
    keys.set(version, decodeKey(encodedKey, version));
  }
  if (!keys.has(currentVersion)) {
    throw new Error("AUDIT_HMAC_KEYS does not contain the current key version.");
  }

  return {
    currentVersion,
    keyForVersion: (version) => keys.get(version) ?? null,
  };
}

export function getAuditKeyring(): AuditKeyring {
  const rawKeys = process.env.AUDIT_HMAC_KEYS;
  const rawVersion = process.env.AUDIT_HMAC_KEY_VERSION ?? "1";
  if (!rawKeys) {
    throw new Error("AUDIT_HMAC_KEYS is required at runtime.");
  }

  let encodedKeys: Record<string, string>;
  try {
    encodedKeys = JSON.parse(rawKeys) as Record<string, string>;
  } catch {
    throw new Error("AUDIT_HMAC_KEYS must be a JSON object of base64 keys.");
  }

  return createAuditKeyring({
    currentVersion: Number(rawVersion),
    encodedKeys,
  });
}

