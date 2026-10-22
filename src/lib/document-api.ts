import { z } from "zod";

const documentName = z
  .string()
  .trim()
  .min(1, "Document name is required.")
  .max(255, "Document name must be 255 characters or fewer.");

const documentDescription = z
  .string()
  .trim()
  .max(1000, "Description must be 1000 characters or fewer.")
  .nullable();

const categoryId = z.string().trim().min(1).max(128).nullable();

export const documentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const documentListQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(100)
      .transform((value) => value || undefined)
      .optional(),
    state: z.enum(["ACTIVE", "DELETED"]).default("ACTIVE"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const createDocumentSchema = z
  .object({
    name: documentName,
    description: documentDescription.optional().default(null),
    categoryId: categoryId.optional().default(null),
  })
  .strict();

export const updateDocumentSchema = z
  .object({
    name: documentName.optional(),
    description: documentDescription.optional(),
    categoryId: categoryId.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one document field to update.",
  });

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

