import { categoryApiHandlers } from "@/lib/server/category-api-handlers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ categoryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { categoryId } = await context.params;
  return categoryApiHandlers.update(request, categoryId);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { categoryId } = await context.params;
  return categoryApiHandlers.remove(request, categoryId);
}
