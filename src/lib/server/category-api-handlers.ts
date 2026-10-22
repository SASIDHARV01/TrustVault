import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import {
  categoryIdSchema,
  createCategorySchema,
  updateCategorySchema,
} from "@/lib/category-api";
import {
  createRequestId,
  getApiActor,
  getAuditRequestContext,
  isTrustedMutationOrigin,
  type ApiActor,
} from "@/lib/server/api-security";
import type { AuditRequestContext } from "@/lib/server/audit-service";
import {
  CategoryServiceError,
  createOwnedCategory,
  deleteOwnedCategory,
  listOwnedCategories,
  updateOwnedCategory,
} from "@/lib/server/category-service";

const maximumJsonBytes = 8 * 1024;

type Dependencies = {
  getActor: () => Promise<ApiActor | null>;
  trustedMutationOrigin: (request: Request) => boolean;
  listCategories: typeof listOwnedCategories;
  createCategory: (
    actor: ApiActor,
    input: Parameters<typeof createOwnedCategory>[1],
    context: AuditRequestContext,
  ) => ReturnType<typeof createOwnedCategory>;
  updateCategory: (
    actor: ApiActor,
    categoryId: string,
    input: Parameters<typeof updateOwnedCategory>[2],
    context: AuditRequestContext,
  ) => ReturnType<typeof updateOwnedCategory>;
  deleteCategory: (
    actor: ApiActor,
    categoryId: string,
    context: AuditRequestContext,
  ) => ReturnType<typeof deleteOwnedCategory>;
};

const defaults: Dependencies = {
  getActor: getApiActor,
  trustedMutationOrigin: isTrustedMutationOrigin,
  listCategories: listOwnedCategories,
  createCategory: (actor, input, context) =>
    createOwnedCategory(actor, input, undefined, context),
  updateCategory: (actor, categoryId, input, context) =>
    updateOwnedCategory(actor, categoryId, input, undefined, context),
  deleteCategory: (actor, categoryId, context) =>
    deleteOwnedCategory(actor, categoryId, undefined, context),
};

function response(requestId: string, body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Request-ID": requestId,
    },
  });
}

function errorResponse(requestId: string, status: number, code: string, message: string) {
  return response(requestId, { error: { code, message } }, status);
}

async function parseJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!contentType.startsWith("application/json")) return null;
  if (Number.isFinite(declaredLength) && declaredLength > maximumJsonBytes) return null;
  if (!request.body) return null;

  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumJsonBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function parseBody<T extends z.ZodType>(schema: T, value: unknown) {
  return schema.safeParse(value);
}

export function createCategoryApiHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };

  async function actor(requestId: string) {
    return await dependencies.getActor() ?? errorResponse(
      requestId,
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication required.",
    );
  }

  function isResponse(value: ApiActor | NextResponse): value is NextResponse {
    return value instanceof Response;
  }

  async function run(requestId: string, operation: () => Promise<NextResponse>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CategoryServiceError) {
        if (error.code === "CATEGORY_NOT_FOUND") {
          return errorResponse(requestId, 404, "CATEGORY_NOT_FOUND", "Category not found.");
        }
        return errorResponse(requestId, 409, "CATEGORY_ALREADY_EXISTS", "A category with that name already exists.");
      }
      console.error("Category API request failed", { requestId, error });
      return errorResponse(requestId, 500, "INTERNAL_ERROR", "The request could not be completed.");
    }
  }

  async function prepareMutation(request: Request, requestId: string) {
    const currentActor = await actor(requestId);
    if (isResponse(currentActor)) return currentActor;
    if (!dependencies.trustedMutationOrigin(request)) {
      return errorResponse(requestId, 403, "UNTRUSTED_ORIGIN", "The request origin is not trusted.");
    }
    return currentActor;
  }

  return {
    list: async () => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const currentActor = await actor(requestId);
        if (isResponse(currentActor)) return currentActor;
        const categories = await dependencies.listCategories(currentActor);
        return response(requestId, { data: { categories } });
      });
    },

    create: async (request: Request) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const currentActor = await prepareMutation(request, requestId);
        if (isResponse(currentActor)) return currentActor;
        const parsed = parseBody(createCategorySchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(requestId, 400, "INVALID_REQUEST", "The category data is invalid.");
        }
        const category = await dependencies.createCategory(
          currentActor,
          parsed.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: { category } }, 201);
      });
    },

    update: async (request: Request, rawCategoryId: string) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const currentActor = await prepareMutation(request, requestId);
        if (isResponse(currentActor)) return currentActor;
        const categoryId = categoryIdSchema.safeParse(rawCategoryId);
        if (!categoryId.success) {
          return errorResponse(requestId, 404, "CATEGORY_NOT_FOUND", "Category not found.");
        }
        const parsed = parseBody(updateCategorySchema, await parseJson(request));
        if (!parsed.success) {
          return errorResponse(requestId, 400, "INVALID_REQUEST", "The category data is invalid.");
        }
        const category = await dependencies.updateCategory(
          currentActor,
          categoryId.data,
          parsed.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: { category } });
      });
    },

    remove: async (request: Request, rawCategoryId: string) => {
      const requestId = createRequestId();
      return run(requestId, async () => {
        const currentActor = await prepareMutation(request, requestId);
        if (isResponse(currentActor)) return currentActor;
        const categoryId = categoryIdSchema.safeParse(rawCategoryId);
        if (!categoryId.success) {
          return errorResponse(requestId, 404, "CATEGORY_NOT_FOUND", "Category not found.");
        }
        const category = await dependencies.deleteCategory(
          currentActor,
          categoryId.data,
          getAuditRequestContext(request, requestId),
        );
        return response(requestId, { data: { category } });
      });
    },
  };
}

export const categoryApiHandlers = createCategoryApiHandlers();
