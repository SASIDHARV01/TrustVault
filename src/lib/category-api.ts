import { z } from "zod";

export const categoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

function normalizeCategoryDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

const categoryName = z
  .string()
  .transform(normalizeCategoryDisplayName)
  .pipe(
    z
      .string()
      .min(1, "Category name is required.")
      .max(80, "Category name must be 80 characters or fewer.")
      .refine(
        (value) =>
          [...value].every((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code > 31 && code !== 127;
          }),
        "Category name contains unsupported control characters.",
      ),
  );

export const createCategorySchema = z.object({ name: categoryName }).strict();
export const updateCategorySchema = z.object({ name: categoryName }).strict();

export function normalizedCategoryName(value: string) {
  return normalizeCategoryDisplayName(value).toLocaleLowerCase("en-US");
}

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
