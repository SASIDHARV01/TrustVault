import { accessIntelligenceApiHandlers } from "@/lib/server/access-intelligence-api-handlers";
import { withSimpleRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withSimpleRequestRateLimit(
  "AUDIT_READ",
  accessIntelligenceApiHandlers.list,
);
