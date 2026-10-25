import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createAuthRateLimitStorage } from "@/lib/server/auth-rate-limit";

describe("Better Auth distributed rate-limit storage", () => {
  it("maps Better Auth rules onto the shared PostgreSQL counter", async () => {
    const database = {} as PrismaClient;
    const consume = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      retryAfterSeconds: 60,
      resetAt: new Date("2026-10-25T00:00:00.000Z"),
    });
    const storage = createAuthRateLimitStorage(database, consume);

    await expect(
      storage.consume("sign-in:203.0.113.1", { window: 60, max: 10 }),
    ).resolves.toEqual({ allowed: true, retryAfter: null });
    expect(consume).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      { windowSeconds: 60, maximum: 10 },
      database,
    );
  });

  it("returns the shared retry window when the request is limited", async () => {
    const consume = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterSeconds: 37,
      resetAt: new Date("2026-10-25T00:00:00.000Z"),
    });
    const storage = createAuthRateLimitStorage({} as PrismaClient, consume);

    await expect(
      storage.consume("sign-up:203.0.113.1", { window: 60, max: 5 }),
    ).resolves.toEqual({ allowed: false, retryAfter: 37 });
  });
});
