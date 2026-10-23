import { permissionApiHandlers } from "@/lib/server/permission-api-handlers";
import { withSimpleRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withSimpleRequestRateLimit(
  "RECIPIENT_LOOKUP",
  permissionApiHandlers.lookupRecipient,
);

