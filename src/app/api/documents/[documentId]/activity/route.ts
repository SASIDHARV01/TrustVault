import { activityApiHandlers } from "@/lib/server/activity-api-handlers";

export const dynamic = "force-dynamic";

type ActivityRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: Request, context: ActivityRouteContext) {
  const { documentId } = await context.params;
  return activityApiHandlers.listDocument(request, documentId);
}

