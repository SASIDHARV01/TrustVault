import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDatabase } from "@/lib/server/database";
import {
  consumeDistributedRateLimit,
  type DistributedRateLimitDecision,
} from "@/lib/server/distributed-rate-limit";

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
  decision: DistributedRateLimitDecision,
) {
  response.headers.set("X-RateLimit-Limit", String(decision.limit));
  response.headers.set("X-RateLimit-Remaining", String(decision.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(decision.resetAt.getTime() / 1000)),
  );
  return response;
}

function limitedResponse(decision: DistributedRateLimitDecision) {
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
