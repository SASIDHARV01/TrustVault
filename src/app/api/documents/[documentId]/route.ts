import { documentApiHandlers } from "@/lib/server/document-api-handlers";

export const dynamic = "force-dynamic";

type DocumentRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: Request, context: DocumentRouteContext) {
  const { documentId } = await context.params;
  return documentApiHandlers.get(request, documentId);
}

export async function PATCH(request: Request, context: DocumentRouteContext) {
  const { documentId } = await context.params;
  return documentApiHandlers.update(request, documentId);
}

export async function DELETE(request: Request, context: DocumentRouteContext) {
  const { documentId } = await context.params;
  return documentApiHandlers.remove(request, documentId);
}

