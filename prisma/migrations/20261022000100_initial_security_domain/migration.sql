-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('READ', 'EDIT');

-- CreateEnum
CREATE TYPE "DocumentState" AS ENUM ('ACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "StorageState" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('AUTH_SIGN_IN', 'AUTH_SIGN_OUT', 'DOCUMENT_UPLOAD', 'DOCUMENT_READ', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_UPDATE', 'DOCUMENT_DELETE', 'DOCUMENT_RESTORE', 'DOCUMENT_VERSION_CREATE', 'PERMISSION_GRANT', 'PERMISSION_UPDATE', 'PERMISSION_REVOKE', 'ADMIN_OVERRIDE_READ', 'AUDIT_VERIFY');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('ALLOWED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditResource" AS ENUM ('AUTH', 'DOCUMENT', 'PERMISSION', 'AUDIT', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "SystemRole" NOT NULL DEFAULT 'MEMBER',
    "disabledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(80) NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(6),
    "refreshTokenExpiresAt" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(320) NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000),
    "state" "DocumentState" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "storageState" "StorageState" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentGrant" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,

    CONSTRAINT "DocumentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "documentId" TEXT,
    "action" "AuditAction" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "resource" "AuditResource" NOT NULL,
    "targetId" VARCHAR(255),
    "reason" VARCHAR(1000),
    "requestId" VARCHAR(128),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "previousHash" CHAR(64) NOT NULL,
    "eventHash" CHAR(64) NOT NULL,
    "hmacKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCheckpoint" (
    "id" TEXT NOT NULL,
    "throughEventId" BIGINT NOT NULL,
    "chainHash" CHAR(64) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_disabledAt_idx" ON "User"("role", "disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_expiresAt_idx" ON "Verification"("identifier", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_ownerId_normalizedName_key" ON "Category"("ownerId", "normalizedName");

-- CreateIndex
CREATE INDEX "Document_ownerId_state_createdAt_idx" ON "Document"("ownerId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Document_categoryId_state_idx" ON "Document"("categoryId", "state");

-- CreateIndex
CREATE INDEX "Document_name_idx" ON "Document"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_storageState_createdAt_idx" ON "DocumentVersion"("documentId", "storageState", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentGrant_recipientId_revokedAt_accessLevel_idx" ON "DocumentGrant"("recipientId", "revokedAt", "accessLevel");

-- CreateIndex
CREATE INDEX "DocumentGrant_documentId_revokedAt_idx" ON "DocumentGrant"("documentId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventId_key" ON "AuditEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "AuditEvent"("actorId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_documentId_occurredAt_idx" ON "AuditEvent"("documentId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_action_outcome_occurredAt_idx" ON "AuditEvent"("action", "outcome", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCheckpoint_throughEventId_key" ON "AuditCheckpoint"("throughEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCheckpoint_storageKey_key" ON "AuditCheckpoint"("storageKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCheckpoint" ADD CONSTRAINT "AuditCheckpoint_throughEventId_fkey" FOREIGN KEY ("throughEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TrustVault invariants that cannot be represented by the Prisma schema.
-- Preserve grant history while allowing only one currently active grant for a
-- recipient/document pair.
CREATE UNIQUE INDEX "DocumentGrant_one_active_recipient_per_document"
ON "DocumentGrant"("documentId", "recipientId")
WHERE "revokedAt" IS NULL;

ALTER TABLE "DocumentGrant"
ADD CONSTRAINT "DocumentGrant_revocation_fields_consistent"
CHECK (
  ("revokedAt" IS NULL AND "revokedById" IS NULL)
  OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)
);

ALTER TABLE "DocumentGrant"
ADD CONSTRAINT "DocumentGrant_recipient_is_not_issuer"
CHECK ("recipientId" <> "grantedById");

ALTER TABLE "Document"
ADD CONSTRAINT "Document_deletion_fields_consistent"
CHECK (
  ("state" = 'ACTIVE' AND "deletedAt" IS NULL AND "deletedById" IS NULL)
  OR ("state" = 'DELETED' AND "deletedAt" IS NOT NULL AND "deletedById" IS NOT NULL)
);

ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_positive_version_number"
CHECK ("versionNumber" > 0);

ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_positive_size"
CHECK ("sizeBytes" > 0);

ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_sha256_is_lowercase_hex"
CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_previous_hash_is_lowercase_hex"
CHECK ("previousHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_event_hash_is_lowercase_hex"
CHECK ("eventHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AuditCheckpoint"
ADD CONSTRAINT "AuditCheckpoint_chain_hash_is_lowercase_hex"
CHECK ("chainHash" ~ '^[0-9a-f]{64}$');

-- These tables are append-only at the database boundary. Application code has
-- no mutation API, and PostgreSQL rejects direct UPDATE/DELETE attempts too.
CREATE FUNCTION "trustvault_reject_immutable_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TrustVault immutable record cannot be updated or deleted';
END;
$$;

CREATE TRIGGER "AuditEvent_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION "trustvault_reject_immutable_mutation"();

CREATE TRIGGER "AuditCheckpoint_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "AuditCheckpoint"
FOR EACH ROW
EXECUTE FUNCTION "trustvault_reject_immutable_mutation"();
