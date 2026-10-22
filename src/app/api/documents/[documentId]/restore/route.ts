import { documentApiHandlers } from "@/lib/server/document-api-handlers";

export const dynamic = "force-dynamic";

type DocumentRestoreRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(request: Request, context: DocumentRestoreRouteContext) {
  const { documentId } = await context.params;
  return documentApiHandlers.restore(request, documentId);
}

