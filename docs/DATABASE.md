# TrustVault Database Architecture

Last verified: 2026-10-23

## Purpose

PostgreSQL stores identities, sessions, searchable document metadata,
permissions, versions, and audit evidence. Document bytes will live in private
Cloudflare R2 storage; the database stores only an unguessable object key and
integrity metadata.

TrustVault uses Prisma ORM 7.10.1 with the PostgreSQL `pg` driver adapter. The
version is deliberately pinned to the stable Prisma 7 line instead of the Prisma
8 release candidate exposed by the CLI package's current `latest` tag.

## Connection model

Two Supabase connection strings have different jobs:

- `DATABASE_URL` is the pooled runtime connection used by the Render application.
- `DIRECT_URL` is the direct connection used only by Prisma migration commands.

`prisma.config.ts` prefers `DIRECT_URL` for CLI operations. The runtime database
factory reads only `DATABASE_URL`, fails closed when it is missing in production,
uses a small connection pool, and is created lazily so static builds do not
require a live database.

Outside production, both tools use the documented local PostgreSQL URL when an
environment variable is absent. This fallback contains no real credential and
cannot silently connect to Supabase.

## Role model

`SystemRole` contains only `MEMBER` and `ADMIN`. Document roles are deliberately
not global account roles:

- ownership is represented by `Document.ownerId`;
- read/edit access is represented by an active `DocumentGrant`;
- administrators use a separately authorized `ADMIN_OVERRIDE_READ` action.

One person can therefore own one document, edit a second, read a third, and have
no access to a fourth. This is the correct resource-level authorization model.

## Core models

### Authentication

`User`, `Session`, `Account`, and `Verification` contain the Better Auth core
fields. Phase 3 will configure Better Auth against these models and register the
optional TrustVault `role` and `disabledAt` user fields.

### Documents

- `Category` is private to its owner and unique by normalized name per owner.
- `Document` stores metadata, ownership, category, and recoverable soft deletion.
- `DocumentVersion` stores immutable version metadata, SHA-256 digest, private
  object key, and an explicit storage workflow state.
- `DocumentGrant` stores named-user `READ` or `EDIT` access and revocation data.

A partial unique index permits only one active grant for a recipient/document
pair while preserving old revoked rows for investigation.

### Audit evidence

`AuditEvent` uses a monotonic database sequence, public event identifier,
allow/deny/failure outcome, request context, previous hash, event hash, and HMAC
key version. Actor and document relations are optional so refused anonymous or
unknown-target requests can still be recorded.

`AuditCheckpoint` links a chain head to its locked-prefix R2 checkpoint object.
PostgreSQL triggers reject updates and deletes on both audit tables. Phase 5 adds
serialized HMAC-chain writes and full-chain verification. Audit actor/document
foreign keys use deletion restriction because setting them to null would mutate
immutable evidence; account disable and document soft deletion preserve history.

Independent R2 chain-head checkpoint writing is implemented in Phase 6. An
internally valid database chain alone cannot prove that a privileged database
operator did not truncate its newest events.

### Operational request limits

`RequestRateLimit` stores fixed-window counters shared by every application
process. Its primary key is a SHA-256 fingerprint of the policy and bounded
client address; raw network addresses are not retained. One PostgreSQL upsert
atomically increments or resets each counter, so concurrent requests cannot all
slip past the configured maximum. The table contains operational state rather
than audit evidence and may be expired by a future maintenance job.

## Database-enforced invariants

The initial SQL migration adds constraints that Prisma cannot express directly:

- one active grant per recipient and document;
- revocation time and revoker must appear together;
- a grant recipient cannot also be its issuer;
- soft-delete state, timestamp, and actor must agree;
- document version and byte size must be positive;
- version and audit hashes must be lowercase 64-character hexadecimal values;
- document version metadata is immutable with allowlisted storage-state
  transitions only; and
- audit events and checkpoints are append-only.

Application validation will provide friendly errors, but these constraints remain
the final protection against bugs, scripts, or bypassed API routes.

## Commands

```bash
npm run db:format
npm run db:validate
npm run db:generate
npm run db:migrate:dev -- --name descriptive-change
npm run db:migrate:deploy
npm run db:migrate:status
```

Use `migrate dev` only against an isolated development database. Production uses
committed migrations through `migrate deploy`; it must never use `db push`.

## Seed-data decision

Phase 3 adds `npm run db:seed:demo`. It creates credential-bearing demo users
through Better Auth's supported hashing and account lifecycle, then applies the
trusted system role and removes seed-created sessions. Raw passwords are never
inserted into PostgreSQL. Existing credential hashes are preserved on rerun so a
seed command cannot silently reset an account password.

## Verification history

The following checks passed before the phase commit:

- Prisma format, schema validation, and client generation;
- ESLint and strict TypeScript validation;
- nine unit/schema-contract tests;
- Next.js production build;
- initial migration against an isolated PostgreSQL 15.14 instance;
- live rejection of duplicate active grants, inconsistent deletion, malformed
  SHA-256 data, audit-event mutation, and audit-checkpoint deletion.

Supabase connectivity is not claimed yet because no project credential has been
provided. Applying the committed migration to Supabase belongs to the environment
connection step, not local schema design.

Phase 9 adds the request-limit migration and an isolated PostgreSQL concurrency
test. The test sends eleven simultaneous attempts against a ten-request policy,
proves exactly ten are admitted, then proves the next time window resets safely.
