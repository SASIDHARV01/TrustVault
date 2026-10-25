import { z } from "zod";

export const accessIntelligenceQuerySchema = z
  .object({
    q: z.string().trim().max(160).optional(),
    status: z.enum(["ACTIVE", "REVOKED"]).optional(),
    accessLevel: z.enum(["READ", "EDIT"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type AccessIntelligenceQuery = z.infer<
  typeof accessIntelligenceQuerySchema
>;
