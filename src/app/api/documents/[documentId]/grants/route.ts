import { permissionApiHandlers } from "@/lib/server/permission-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type GrantCollectionRouteContext = {
  params: Promise<{ documentId: string }>;
};

const list = async (request: Request, context: GrantCollectionRouteContext) => {
  const { documentId } = await context.params;
  return permissionApiHandlers.listGrants(request, documentId);
};

const create = async (request: Request, context: GrantCollectionRouteContext) => {
  const { documentId } = await context.params;
  return permissionApiHandlers.createGrant(request, documentId);
};

export const GET = withRequestRateLimit("AUDIT_READ", list);
export const POST = withRequestRateLimit("DOCUMENT_MUTATION", create);

