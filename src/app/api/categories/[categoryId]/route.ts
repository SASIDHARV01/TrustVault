import { categoryApiHandlers } from "@/lib/server/category-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ categoryId: string }> };

const update = async (request: Request, context: RouteContext) => {
  const { categoryId } = await context.params;
  return categoryApiHandlers.update(request, categoryId);
};

const remove = async (request: Request, context: RouteContext) => {
  const { categoryId } = await context.params;
  return categoryApiHandlers.remove(request, categoryId);
};

export const PATCH = withRequestRateLimit("DOCUMENT_MUTATION", update);
export const DELETE = withRequestRateLimit("DOCUMENT_MUTATION", remove);
