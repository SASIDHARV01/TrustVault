import { z } from "zod";

const recipientEmail = z
  .string()
  .trim()
  .email("Enter a valid recipient email address.")
  .max(320)
  .transform((value) => value.toLowerCase());

export const accessLevelSchema = z.enum(["READ", "EDIT"]);

export const recipientLookupQuerySchema = z
  .object({ email: recipientEmail })
  .strict();

export const createGrantSchema = z
  .object({
    recipientEmail,
    accessLevel: accessLevelSchema,
  })
  .strict();

export const updateGrantSchema = z
  .object({ accessLevel: accessLevelSchema })
  .strict();

export const grantIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export type CreateGrantInput = z.infer<typeof createGrantSchema>;
export type UpdateGrantInput = z.infer<typeof updateGrantSchema>;

