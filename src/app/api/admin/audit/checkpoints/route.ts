import { auditCheckpointApiHandlers } from "@/lib/server/audit-checkpoint-api-handlers";
import { withSimpleRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withSimpleRequestRateLimit(
  "AUDIT_READ",
  auditCheckpointApiHandlers.list,
);
export const POST = withSimpleRequestRateLimit(
  "AUDIT_CHECKPOINT",
  auditCheckpointApiHandlers.create,
);
