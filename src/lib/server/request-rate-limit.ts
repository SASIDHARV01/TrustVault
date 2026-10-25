import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDatabase } from "@/lib/server/database";

export const requestRateLimitPolicies = {
  DOCUMENT_SEARCH: { windowSeconds: 60, maximum: 120 },
  DOCUMENT_MUTATION: { windowSeconds: 60, maximum: 60 },
  DOCUMENT_UPLOAD: { windowSeconds: 600, maximum: 20 },
  DOCUMENT_CONTENT: { windowSeconds: 60, maximum: 120 },
  RECIPIENT_LOOKUP: { windowSeconds: 60, maximum: 30 },
  AUDIT_READ: { windowSeconds: 60, maximum: 120 },
  AUDIT_VERIFY: { windowSeconds: 600, maximum: 10 },
  AUDIT_CHECKPOINT: { windowSeconds: 600, maximum: 10 },
} as const;

export type RequestRateLimitPolicy = keyof typeof requestRateLimitPolicies;

type RateLimitRow = { count: number; windowStartedAt: Date };

export type DistributedRateLimitRule = {
  windowSeconds: number;
  maximum: number;
};

export type RequestRateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
};

function normalizedClientAddress(request: Request) {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  return (cloudflare || forwarded || direct || "unknown-client").slice(0, 128);
}

export function requestRateLimitKey(
  request: Request,
  policy: RequestRateLimitPolicy,
) {
  return createHash("sha256")
    .update(`${policy}\0${normalizedClientAddress(request)}`, "utf8")
    .digest("hex");
}

export async function consumeDistributedRateLimit(
  key: string,
  rule: DistributedRateLimitRule,
  database: PrismaClient = getDatabase(),
  now = new Date(),
): Promise<RequestRateLimitDecision> {
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

export async function consumeRequestRateLimit(
  request: Request,
  policy: RequestRateLimitPolicy,
  database: PrismaClient = getDatabase(),
  now = new Date(),
) {
  return consumeDistributedRateLimit(
    requestRateLimitKey(request, policy),
    requestRateLimitPolicies[policy],
    database,
    now,
  );
}

function applyDecisionHeaders(
  response: Response,
  decision: RequestRateLimitDecision,
) {
  response.headers.set("X-RateLimit-Limit", String(decision.limit));
  response.headers.set("X-RateLimit-Remaining", String(decision.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(decision.resetAt.getTime() / 1000)),
  );
  return response;
}

function limitedResponse(decision: RequestRateLimitDecision) {
  const requestId = randomUUID();
  const response = Response.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "Retry-After": String(decision.retryAfterSeconds),
        "X-Request-ID": requestId,
      },
    },
  );
  return applyDecisionHeaders(response, decision);
}

export function withRequestRateLimit<Context>(
  policy: RequestRateLimitPolicy,
  handler: (request: Request, context: Context) => Promise<Response> | Response,
  consume: typeof consumeRequestRateLimit = consumeRequestRateLimit,
) {
  return async (request: Request, context: Context) => {
    const decision = await consume(request, policy);
    if (!decision.allowed) return limitedResponse(decision);
    return applyDecisionHeaders(await handler(request, context), decision);
  };
}

export function withSimpleRequestRateLimit(
  policy: RequestRateLimitPolicy,
  handler: (request: Request) => Promise<Response> | Response,
  consume: typeof consumeRequestRateLimit = consumeRequestRateLimit,
) {
  return async (request: Request) => {
    const decision = await consume(request, policy);
    if (!decision.allowed) return limitedResponse(decision);
    return applyDecisionHeaders(await handler(request), decision);
  };
}
