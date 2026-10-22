import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/lib/category-api";
import { normalizedCategoryName } from "@/lib/category-api";
import {
  appendAuditEventInTransaction,
  type AuditRequestContext,
} from "@/lib/server/audit-service";
import { getDatabase, runSerializableTransaction } from "@/lib/server/database";
import type { DocumentActor } from "@/lib/server/document-service";

export class CategoryServiceError extends Error {
  constructor(readonly code: "CATEGORY_NOT_FOUND" | "CATEGORY_ALREADY_EXISTS") {
    super(code);
    this.name = "CategoryServiceError";
  }
}

const categorySelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      documents: { where: { state: "ACTIVE" as const } },
    },
  },
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

function serializeCategory(category: CategoryRow) {
  return {
    id: category.id,
    name: category.name,
    activeDocumentCount: category._count.documents,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

async function recordCategoryAudit(
  database: Prisma.TransactionClient,
  context: AuditRequestContext | undefined,
  input: Parameters<typeof appendAuditEventInTransaction>[1],
) {
  if (context) {
    await appendAuditEventInTransaction(database, { ...input, context });
  }
}

export async function listOwnedCategories(
  actor: DocumentActor,
  database: PrismaClient = getDatabase(),
) {
  const categories = await database.category.findMany({
    where: { ownerId: actor.id },
    orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
    select: categorySelect,
  });
  return categories.map(serializeCategory);
}

export async function createOwnedCategory(
  actor: DocumentActor,
  input: CreateCategoryInput,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(database, async (transaction) => {
    const normalizedName = normalizedCategoryName(input.name);
    const existing = await transaction.category.findUnique({
      where: { ownerId_normalizedName: { ownerId: actor.id, normalizedName } },
      select: { id: true },
    });
    if (existing) {
      await recordCategoryAudit(transaction, auditContext, {
        actorId: actor.id,
        action: "CATEGORY_CREATE",
        outcome: "DENIED",
        resource: "CATEGORY",
        targetId: existing.id,
        reason: "CATEGORY_ALREADY_EXISTS",
      });
      return { error: new CategoryServiceError("CATEGORY_ALREADY_EXISTS") } as const;
    }

    const category = await transaction.category.create({
      data: { ownerId: actor.id, name: input.name, normalizedName },
      select: categorySelect,
    });
    await recordCategoryAudit(transaction, auditContext, {
      actorId: actor.id,
      action: "CATEGORY_CREATE",
      outcome: "ALLOWED",
      resource: "CATEGORY",
      targetId: category.id,
      reason: "ALLOW_OWNER",
    });
    return { value: serializeCategory(category) } as const;
  });
  if ("error" in result) throw result.error;
  return result.value;
}

export async function updateOwnedCategory(
  actor: DocumentActor,
  categoryId: string,
  input: UpdateCategoryInput,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(database, async (transaction) => {
    const category = await transaction.category.findFirst({
      where: { id: categoryId, ownerId: actor.id },
      select: { id: true },
    });
    if (!category) {
      await recordCategoryAudit(transaction, auditContext, {
        actorId: actor.id,
        action: "CATEGORY_UPDATE",
        outcome: "DENIED",
        resource: "CATEGORY",
        targetId: categoryId,
        reason: "DENY_OWNER_REQUIRED",
      });
      return { error: new CategoryServiceError("CATEGORY_NOT_FOUND") } as const;
    }

    const normalizedName = normalizedCategoryName(input.name);
    const duplicate = await transaction.category.findFirst({
      where: { ownerId: actor.id, normalizedName, id: { not: categoryId } },
      select: { id: true },
    });
    if (duplicate) {
      await recordCategoryAudit(transaction, auditContext, {
        actorId: actor.id,
        action: "CATEGORY_UPDATE",
        outcome: "DENIED",
        resource: "CATEGORY",
        targetId: categoryId,
        reason: "CATEGORY_ALREADY_EXISTS",
      });
      return { error: new CategoryServiceError("CATEGORY_ALREADY_EXISTS") } as const;
    }

    const updated = await transaction.category.update({
      where: { id: categoryId },
      data: { name: input.name, normalizedName },
      select: categorySelect,
    });
    await recordCategoryAudit(transaction, auditContext, {
      actorId: actor.id,
      action: "CATEGORY_UPDATE",
      outcome: "ALLOWED",
      resource: "CATEGORY",
      targetId: categoryId,
      reason: "ALLOW_OWNER",
    });
    return { value: serializeCategory(updated) } as const;
  });
  if ("error" in result) throw result.error;
  return result.value;
}

export async function deleteOwnedCategory(
  actor: DocumentActor,
  categoryId: string,
  database: PrismaClient = getDatabase(),
  auditContext?: AuditRequestContext,
) {
  const result = await runSerializableTransaction(database, async (transaction) => {
    const category = await transaction.category.findFirst({
      where: { id: categoryId, ownerId: actor.id },
      select: categorySelect,
    });
    if (!category) {
      await recordCategoryAudit(transaction, auditContext, {
        actorId: actor.id,
        action: "CATEGORY_DELETE",
        outcome: "DENIED",
        resource: "CATEGORY",
        targetId: categoryId,
        reason: "DENY_OWNER_REQUIRED",
      });
      return { error: new CategoryServiceError("CATEGORY_NOT_FOUND") } as const;
    }

    await transaction.category.delete({ where: { id: categoryId } });
    await recordCategoryAudit(transaction, auditContext, {
      actorId: actor.id,
      action: "CATEGORY_DELETE",
      outcome: "ALLOWED",
      resource: "CATEGORY",
      targetId: categoryId,
      reason: "ALLOW_OWNER",
      metadata: { detachedActiveDocumentCount: category._count.documents },
    });
    return { value: serializeCategory(category) } as const;
  });
  if ("error" in result) throw result.error;
  return result.value;
}
