import { permissionApiHandlers } from "@/lib/server/permission-api-handlers";

export const dynamic = "force-dynamic";

type GrantCollectionRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: Request, context: GrantCollectionRouteContext) {
  const { documentId } = await context.params;
  return permissionApiHandlers.listGrants(request, documentId);
}

export async function POST(request: Request, context: GrantCollectionRouteContext) {
  const { documentId } = await context.params;
  return permissionApiHandlers.createGrant(request, documentId);
}

