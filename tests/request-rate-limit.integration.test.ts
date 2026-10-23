import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  consumeRequestRateLimit,
  requestRateLimitKey,
} from "../src/lib/server/request-rate-limit";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("shared PostgreSQL request rate limiter", () => {
  if (!databaseUrl) return;

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 12 }),
  });
  const address = `198.51.100.${(process.pid % 200) + 1}`;
  const request = new Request("https://trustvault.test/api/admin/audit/verify", {
    headers: { "x-forwarded-for": address },
  });
  const key = requestRateLimitKey(request, "AUDIT_VERIFY");
  const startedAt = new Date("2026-10-23T00:00:00.000Z");

  afterAll(async () => {
    await database.requestRateLimit.deleteMany({ where: { key } });
    await database.$disconnect();
  });

  it("atomically admits the limit, refuses overflow, and resets the window", async () => {
    await database.requestRateLimit.deleteMany({ where: { key } });

    const decisions = await Promise.all(
      Array.from({ length: 11 }, () =>
        consumeRequestRateLimit(request, "AUDIT_VERIFY", database, startedAt),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1);
    expect(await database.requestRateLimit.findUnique({ where: { key } }))
      .toMatchObject({ count: 11, windowStartedAt: startedAt });

    const reset = await consumeRequestRateLimit(
      request,
      "AUDIT_VERIFY",
      database,
      new Date(startedAt.getTime() + 600_001),
    );
    expect(reset).toMatchObject({ allowed: true, remaining: 9 });
  });
});
