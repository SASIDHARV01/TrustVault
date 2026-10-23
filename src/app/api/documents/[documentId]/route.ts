import { documentApiHandlers } from "@/lib/server/document-api-handlers";
import { withRequestRateLimit } from "@/lib/server/request-rate-limit";

export const dynamic = "force-dynamic";

type DocumentRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: Request, context: DocumentRouteContext) {
  const { documentId } = await context.params;
  return documentApiHandlers.get(request, documentId);
}

const update = async (request: Request, context: DocumentRouteContext) => {
  const { documentId } = await context.params;
  return documentApiHandlers.update(request, documentId);
};

const remove = async (request: Request, context: DocumentRouteContext) => {
  const { documentId } = await context.params;
  return documentApiHandlers.remove(request, documentId);
};

export const PATCH = withRequestRateLimit("DOCUMENT_MUTATION", update);
export const DELETE = withRequestRateLimit("DOCUMENT_MUTATION", remove);

