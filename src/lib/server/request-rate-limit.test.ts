import { describe, expect, it, vi } from "vitest";

import {
  consumeRequestRateLimit,
  requestRateLimitKey,
  withSimpleRequestRateLimit,
} from "@/lib/server/request-rate-limit";

describe("request rate limiting", () => {
  it("uses the trusted edge address without storing the raw address", () => {
    const request = new Request("https://trustvault.test/api/documents", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.7",
      },
    });
    const key = requestRateLimitKey(request, "DOCUMENT_SEARCH");

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.10");
    expect(requestRateLimitKey(request, "AUDIT_READ")).not.toBe(key);
  });

  it("returns bounded fixed-window decisions from the shared counter", async () => {
    const now = new Date("2026-10-23T00:00:00.000Z");
    const queryRaw = vi.fn().mockResolvedValue([
      { count: 121, windowStartedAt: now },
    ]);
    const decision = await consumeRequestRateLimit(
      new Request("https://trustvault.test/api/documents"),
      "DOCUMENT_SEARCH",
      { $queryRaw: queryRaw } as never,
      now,
    );

    expect(decision).toMatchObject({
      allowed: false,
      limit: 120,
      remaining: 0,
      retryAfterSeconds: 60,
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("returns a private 429 without calling the protected handler", async () => {
    const handler = vi.fn();
    const consume = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      retryAfterSeconds: 30,
      resetAt: new Date("2026-10-23T00:00:30.000Z"),
    });
    const wrapped = withSimpleRequestRateLimit(
      "AUDIT_VERIFY",
      handler,
      consume,
    );
    const response = await wrapped(
      new Request("https://trustvault.test/api/admin/audit/verify"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
