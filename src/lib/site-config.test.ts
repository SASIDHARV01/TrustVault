import { describe, expect, it } from "vitest";

import { siteConfig } from "./site-config";

describe("siteConfig", () => {
  it("keeps navigation targets local to the public page", () => {
    expect(siteConfig.navigation).toHaveLength(3);
    expect(siteConfig.navigation.every((item) => item.href.startsWith("#"))).toBe(
      true,
    );
  });

  it("states the three security promises shown to visitors", () => {
    expect(siteConfig.safeguards).toEqual([
      "Server-side authorization",
      "Immediate permission revocation",
      "Tamper-evident activity records",
    ]);
  });
});
