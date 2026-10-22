import { documentContentApiHandlers } from "@/lib/server/document-content-api-handlers";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string; versionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { documentId, versionId } = await context.params;
  return documentContentApiHandlers.getContent(request, documentId, versionId);
}
