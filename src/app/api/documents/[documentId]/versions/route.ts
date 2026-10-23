import { documentContentApiHandlers } from "@/lib/server/document-content-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  return documentContentApiHandlers.listVersions(request, documentId);
}

const upload = async (request: Request, context: RouteContext) => {
  const { documentId } = await context.params;
  return documentContentApiHandlers.upload(request, documentId);
};

export const POST = withRequestRateLimit("DOCUMENT_UPLOAD", upload);
