ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_CHECKPOINT_CREATE';

CREATE OR REPLACE FUNCTION prevent_document_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document versions are immutable';
  END IF;

  IF NEW."id" <> OLD."id"
    OR NEW."documentId" <> OLD."documentId"
    OR NEW."versionNumber" <> OLD."versionNumber"
    OR NEW."originalFilename" <> OLD."originalFilename"
    OR NEW."mimeType" <> OLD."mimeType"
    OR NEW."sizeBytes" <> OLD."sizeBytes"
    OR NEW."sha256" <> OLD."sha256"
    OR NEW."storageKey" <> OLD."storageKey"
    OR NEW."createdById" <> OLD."createdById"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'document version metadata is immutable';
  END IF;

  IF NOT (
    (OLD."storageState" = 'PENDING' AND NEW."storageState" IN ('READY', 'FAILED'))
    OR (OLD."storageState" = 'READY' AND NEW."storageState" = 'DELETED')
  ) THEN
    RAISE EXCEPTION 'invalid document version storage state transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DocumentVersion_prevent_mutation"
BEFORE UPDATE OR DELETE ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION prevent_document_version_mutation();

CREATE OR REPLACE FUNCTION prevent_audit_checkpoint_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit checkpoints are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditCheckpoint_prevent_mutation"
BEFORE UPDATE OR DELETE ON "AuditCheckpoint"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_checkpoint_mutation();
