import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  consumeDistributedRateLimit,
  type DistributedRateLimitDecision,
} from "@/lib/server/distributed-rate-limit";

type ConsumeDistributedRateLimit = (
  key: string,
  rule: { windowSeconds: number; maximum: number },
  database: PrismaClient,
) => Promise<DistributedRateLimitDecision>;

export function createAuthRateLimitStorage(
  database: PrismaClient,
  consume: ConsumeDistributedRateLimit = consumeDistributedRateLimit,
) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const databaseKey = createHash("sha256")
        .update(`BETTER_AUTH\0${key}`, "utf8")
        .digest("hex");
      const decision = await consume(
        databaseKey,
        { windowSeconds: rule.window, maximum: rule.max },
        database,
      );

      return {
        allowed: decision.allowed,
        retryAfter: decision.allowed ? null : decision.retryAfterSeconds,
      };
    },
  };
}
