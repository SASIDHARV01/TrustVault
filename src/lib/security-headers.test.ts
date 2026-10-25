import { describe, expect, it } from "vitest";

import { protectedContentSecurityPolicy } from "@/lib/security-headers";

describe("protected page content security policy", () => {
  it("uses a request nonce instead of unsafe inline script execution", () => {
    const policy = protectedContentSecurityPolicy("unique-nonce", false);

    expect(policy).toContain("script-src 'self' 'nonce-unique-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-unique-nonce'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'self' blob:");
    expect(policy).toContain("object-src 'none'");
  });

  it("allows eval only for the Next.js development debugger", () => {
    expect(protectedContentSecurityPolicy("dev-nonce", true)).toContain(
      "'unsafe-eval'",
    );
  });
});
