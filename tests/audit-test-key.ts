export function getAuditTestKey() {
  const configured = process.env.AUDIT_HMAC_KEYS;
  if (!configured) return Buffer.alloc(32, 21).toString("base64");

  const encodedKey = (JSON.parse(configured) as Record<string, unknown>)["1"];
  if (typeof encodedKey !== "string") {
    throw new Error("AUDIT_HMAC_KEYS must contain test key version 1.");
  }
  return encodedKey;
}
