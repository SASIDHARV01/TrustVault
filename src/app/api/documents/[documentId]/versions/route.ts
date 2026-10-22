import { documentContentApiHandlers } from "@/lib/server/document-content-api-handlers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  return documentContentApiHandlers.listVersions(request, documentId);
}

export async function POST(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  return documentContentApiHandlers.upload(request, documentId);
}
