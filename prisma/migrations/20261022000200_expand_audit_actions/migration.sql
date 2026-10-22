ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_METADATA_READ';
ALTER TYPE "AuditAction" ADD VALUE 'PERMISSION_LIST';
ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_VIEW';

-- Immutable audit rows cannot participate in ON DELETE SET NULL because that
-- would update historical evidence. TrustVault disables users and soft-deletes
-- documents, so referenced security actors/resources are physically restricted.
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_actorId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_documentId_fkey";

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

