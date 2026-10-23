import { documentApiHandlers } from "@/lib/server/document-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type DocumentRestoreRouteContext = {
  params: Promise<{ documentId: string }>;
};

const restore = async (request: Request, context: DocumentRestoreRouteContext) => {
  const { documentId } = await context.params;
  return documentApiHandlers.restore(request, documentId);
};

export const POST = withRequestRateLimit("DOCUMENT_MUTATION", restore);

