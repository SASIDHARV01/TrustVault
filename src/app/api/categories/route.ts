import { categoryApiHandlers } from "@/lib/server/category-api-handlers";

export const dynamic = "force-dynamic";

export const GET = categoryApiHandlers.list;
export const POST = categoryApiHandlers.create;
