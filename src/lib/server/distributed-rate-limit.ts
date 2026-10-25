import type { PrismaClient } from "@/generated/prisma/client";

type RateLimitRow = { count: number; windowStartedAt: Date };

export type DistributedRateLimitRule = {
  windowSeconds: number;
  maximum: number;
};

export type DistributedRateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
};

// This module intentionally has no `server-only` marker. The same database
// counter is loaded by Next.js request handlers and by trusted Node.js scripts
// such as the demo-user seed command.
export async function consumeDistributedRateLimit(
  key: string,
  rule: DistributedRateLimitRule,
  database: PrismaClient,
  now = new Date(),
): Promise<DistributedRateLimitDecision> {
  const resetBefore = new Date(now.getTime() - rule.windowSeconds * 1000);

  const rows = await database.$queryRaw<RateLimitRow[]>`
    INSERT INTO "RequestRateLimit"
      ("key", "count", "windowStartedAt", "updatedAt")
    VALUES
      (${key}, 1, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RequestRateLimit"."windowStartedAt" <= ${resetBefore} THEN 1
        ELSE LEAST("RequestRateLimit"."count" + 1, ${rule.maximum + 1})
      END,
      "windowStartedAt" = CASE
        WHEN "RequestRateLimit"."windowStartedAt" <= ${resetBefore} THEN ${now}
        ELSE "RequestRateLimit"."windowStartedAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "windowStartedAt"
  `;
  const row = rows[0];
  if (!row) throw new Error("Rate-limit counter did not return a row.");

  const resetAt = new Date(
    row.windowStartedAt.getTime() + rule.windowSeconds * 1000,
  );
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: row.count <= rule.maximum,
    limit: rule.maximum,
    remaining: Math.max(0, rule.maximum - row.count),
    retryAfterSeconds,
    resetAt,
  };
}
