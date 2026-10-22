import { describe, expect, it } from "vitest";

import { getR2Config } from "./storage-config";

const validEnvironment = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "0123456789abcdef0123456789abcdef",
  R2_SECRET_ACCESS_KEY: "a".repeat(64),
  R2_BUCKET_NAME: "trustvault-documents",
};

describe("R2 runtime configuration", () => {
  it("derives the default endpoint instead of trusting an arbitrary URL", () => {
    expect(getR2Config(validEnvironment)).toMatchObject({
      bucket: "trustvault-documents",
      jurisdiction: "default",
      endpoint:
        "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    });
  });

  it("supports Cloudflare jurisdiction-specific endpoints", () => {
    expect(
      getR2Config({ ...validEnvironment, R2_JURISDICTION: "eu" }).endpoint,
    ).toBe(
      "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com",
    );
  });

  it.each([
    [{ ...validEnvironment, R2_ACCOUNT_ID: "replace-with-cloudflare-account-id" }],
    [{ ...validEnvironment, R2_BUCKET_NAME: "Invalid_Bucket" }],
    [{ ...validEnvironment, R2_JURISDICTION: "moon" }],
    [{ ...validEnvironment, R2_ACCESS_KEY_ID: "z".repeat(32) }],
    [{ ...validEnvironment, R2_SECRET_ACCESS_KEY: "short" }],
  ])("fails closed for invalid configuration", (environment) => {
    expect(() => getR2Config(environment)).toThrow();
  });
});
