import { auditCheckpointApiHandlers } from "@/lib/server/audit-checkpoint-api-handlers";

export const dynamic = "force-dynamic";

export const GET = auditCheckpointApiHandlers.list;
export const POST = auditCheckpointApiHandlers.create;
