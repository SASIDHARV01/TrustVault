import { z } from "zod";

export const auditActions = [
  "AUTH_SIGN_IN",
  "AUTH_SIGN_OUT",
  "DOCUMENT_CREATE",
  "DOCUMENT_METADATA_READ",
  "DOCUMENT_UPLOAD",
  "DOCUMENT_READ",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_UPDATE",
  "DOCUMENT_DELETE",
  "DOCUMENT_RESTORE",
  "DOCUMENT_VERSION_CREATE",
  "PERMISSION_GRANT",
  "PERMISSION_LIST",
  "PERMISSION_UPDATE",
  "PERMISSION_REVOKE",
  "ADMIN_OVERRIDE_READ",
  "AUDIT_VIEW",
  "AUDIT_VERIFY",
  "AUDIT_CHECKPOINT_CREATE",
] as const;

const optionalId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional();

const commonFilters = {
  action: z.enum(auditActions).optional(),
  outcome: z.enum(["ALLOWED", "DENIED", "FAILED"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const documentActivityQuerySchema = z.object(commonFilters).strict();

export const adminActivityQuerySchema = z
  .object({
    ...commonFilters,
    actorId: optionalId,
    documentId: optionalId,
  })
  .strict();

export type DocumentActivityQuery = z.infer<typeof documentActivityQuerySchema>;
export type AdminActivityQuery = z.infer<typeof adminActivityQuerySchema>;

