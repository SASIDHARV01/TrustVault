import { documentApiHandlers } from "@/lib/server/document-api-handlers";
import { withSimpleRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withSimpleRequestRateLimit(
  "DOCUMENT_SEARCH",
  documentApiHandlers.list,
);
export const POST = withSimpleRequestRateLimit(
  "DOCUMENT_MUTATION",
  documentApiHandlers.create,
);

