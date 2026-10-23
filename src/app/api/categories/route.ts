import { categoryApiHandlers } from "@/lib/server/category-api-handlers";
import { withSimpleRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

export const GET = categoryApiHandlers.list;
export const POST = withSimpleRequestRateLimit(
  "DOCUMENT_MUTATION",
  categoryApiHandlers.create,
);
