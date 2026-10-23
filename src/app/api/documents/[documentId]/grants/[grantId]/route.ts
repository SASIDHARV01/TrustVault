import { permissionApiHandlers } from "@/lib/server/permission-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type GrantRouteContext = {
  params: Promise<{ documentId: string; grantId: string }>;
};

const update = async (request: Request, context: GrantRouteContext) => {
  const { documentId, grantId } = await context.params;
  return permissionApiHandlers.updateGrant(request, documentId, grantId);
};

const revoke = async (request: Request, context: GrantRouteContext) => {
  const { documentId, grantId } = await context.params;
  return permissionApiHandlers.revokeGrant(request, documentId, grantId);
};

export const PATCH = withRequestRateLimit("DOCUMENT_MUTATION", update);
export const DELETE = withRequestRateLimit("DOCUMENT_MUTATION", revoke);

