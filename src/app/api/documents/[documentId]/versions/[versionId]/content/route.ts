import { documentContentApiHandlers } from "@/lib/server/document-content-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string; versionId: string }>;
};

const getContent = async (request: Request, context: RouteContext) => {
  const { documentId, versionId } = await context.params;
  return documentContentApiHandlers.getContent(request, documentId, versionId);
};

export const GET = withRequestRateLimit("DOCUMENT_CONTENT", getContent);
