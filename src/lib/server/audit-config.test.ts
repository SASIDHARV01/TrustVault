import { describe, expect, it } from "vitest";

import { createAuditKeyring } from "./audit-config";

const encodedKey = Buffer.alloc(32, 9).toString("base64");

describe("audit HMAC keyring", () => {
  it("loads the current key and retains historical versions", () => {
    const keyring = createAuditKeyring({
      currentVersion: 2,
      encodedKeys: { 1: encodedKey, 2: Buffer.alloc(32, 10).toString("base64") },
    });
    expect(keyring.currentVersion).toBe(2);
    expect(keyring.keyForVersion(1)).toHaveLength(32);
    expect(keyring.keyForVersion(3)).toBeNull();
  });

  it("rejects missing current, weak, and invalid key versions", () => {
    expect(() =>
      createAuditKeyring({ currentVersion: 2, encodedKeys: { 1: encodedKey } }),
    ).toThrow(/current key version/);
    expect(() =>
      createAuditKeyring({
        currentVersion: 1,
        encodedKeys: { 1: Buffer.alloc(8).toString("base64") },
      }),
    ).toThrow(/at least 32 bytes/);
    expect(() =>
      createAuditKeyring({ currentVersion: 0, encodedKeys: { 1: encodedKey } }),
    ).toThrow(/positive integer/);
  });
});

