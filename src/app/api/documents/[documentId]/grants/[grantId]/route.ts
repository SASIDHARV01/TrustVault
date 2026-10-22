import { permissionApiHandlers } from "@/lib/server/permission-api-handlers";

export const dynamic = "force-dynamic";

type GrantRouteContext = {
  params: Promise<{ documentId: string; grantId: string }>;
};

export async function PATCH(request: Request, context: GrantRouteContext) {
  const { documentId, grantId } = await context.params;
  return permissionApiHandlers.updateGrant(request, documentId, grantId);
}

export async function DELETE(request: Request, context: GrantRouteContext) {
  const { documentId, grantId } = await context.params;
  return permissionApiHandlers.revokeGrant(request, documentId, grantId);
}

