import { documentApiHandlers } from "@/lib/server/document-api-handlers";

export const dynamic = "force-dynamic";

export const GET = documentApiHandlers.list;
export const POST = documentApiHandlers.create;

