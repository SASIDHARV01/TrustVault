import { activityApiHandlers } from "@/lib/server/activity-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type ActivityRouteContext = {
  params: Promise<{ documentId: string }>;
};

const list = async (request: Request, context: ActivityRouteContext) => {
  const { documentId } = await context.params;
  return activityApiHandlers.listDocument(request, documentId);
};

export const GET = withRequestRateLimit("AUDIT_READ", list);

