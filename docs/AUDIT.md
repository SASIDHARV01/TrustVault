# TrustVault Audit Trail

Last verified: 2026-10-22

## Purpose

TrustVault records security-sensitive decisions as structured evidence. The log
answers who attempted an action, what resource was involved, whether the server
allowed or denied it, why the policy reached that decision, and which request
produced the event. It never stores passwords, session cookies, document bytes,
or unrestricted request bodies.

Phase 5 covers authentication, document-metadata, permission-management, audit-
view, and audit-verification activity. Upload, preview, download, immutable
versions, and administrator override events will use the same writer when those
features are implemented.

## Event integrity

Every event contains `previousHash` and `eventHash`. `eventHash` is an HMAC-
SHA-256 over a deterministic JSON representation of all security-relevant event
fields, including the previous hash and key version. The first event points to a
64-zero genesis hash.

The HMAC key is independent from the authentication secret. Runtime
configuration uses:

```dotenv
AUDIT_HMAC_KEY_VERSION=1
AUDIT_HMAC_KEYS={"1":"base64-encoded-key-with-at-least-32-bytes"}
```

Old keys must remain available while events signed by those versions exist.
Changing `AUDIT_HMAC_KEY_VERSION` selects the key for new events without making
old evidence unverifiable. Never expose either audit variable through a
`NEXT_PUBLIC_` name or commit real key material.

Writes take one PostgreSQL transaction-level advisory lock and run in a
serializable transaction. This creates exactly one order even when requests
finish concurrently. Bounded retry handles serialization conflicts. Protected
document and permission mutations append their event inside the same database
transaction, so the business change rolls back if its audit evidence cannot be
signed or stored.

PostgreSQL triggers reject `UPDATE` and `DELETE` on audit rows. Actor and document
foreign keys use `ON DELETE RESTRICT`; users are disabled and documents are soft-
deleted instead of physically removing referenced history.

## Recorded context and privacy

The server derives actor, action, outcome, resource, and policy reason. It also
records a generated request ID, the Cloudflare client address or first forwarded
address, and a length-bounded user agent. Structured metadata is allowlisted by
the operation. Client JSON cannot choose the audit actor or outcome.

Activity responses intentionally omit `eventHash`, `previousHash`, HMAC key
version, IP address, and user agent. Those fields remain server-side evidence,
not general profile data.

## Read and verification authorization

- `GET /api/documents/:documentId/activity` is owner-only through the centralized
  `VIEW_ACTIVITY` policy. An inaccessible document returns the same non-revealing
  not-found response.
- `GET /api/admin/activity` is administrator-only and supports bounded filters
  for actor, document, action, outcome, date range, page, and page size.
- `POST /api/admin/audit/verify` is administrator-only, requires a trusted
  mutation origin, and verifies the full chain from genesis using every required
  key version.

Viewing or attempting to view activity creates an `AUDIT_VIEW` event. A valid
verification appends `AUDIT_VERIFY` containing the verified event count and head
hash. The returned count and head describe the chain immediately before that new
verification event is appended. An invalid chain is not extended.

## Detection boundaries

The verifier detects modified signed fields, unknown key versions, broken links,
and missing or reordered events inside the chain. Database triggers also stop
ordinary application and database clients from mutating audit evidence.

A privileged database operator who can disable triggers could remove the newest
event and leave a shorter internally valid chain. Detecting that tail deletion
requires comparison with a chain-head checkpoint held outside PostgreSQL. The
schema reserves `AuditCheckpoint`; writing signed chain heads to locked private
Cloudflare R2 is part of the storage phase. Until that independent checkpoint is
enabled, TrustVault must not claim protection from a database-superuser tail-
truncation attack.

## Verification evidence

Phase 5 automated checks cover:

- deterministic hashing, metadata key ordering, modified fields, missing middle
  events, reordered events, and unknown key versions;
- strict activity filters, authentication, owner/admin boundaries, safe response
  projection, trusted-origin verification, and non-enumerating errors;
- twelve concurrent standalone writers and twelve concurrent audited application
  reads each producing one valid chain;
- allowed and denied document/permission actions with request correlation;
- rollback of a document update when its audit key configuration is invalid;
- database rejection of audit update/delete attempts; and
- absence of representative passwords, cookies, and document content in stored
  audit payloads.

The live suite uses an isolated PostgreSQL 15 database. It does not prove the
future R2 checkpoint, document-byte events, deployed Supabase permissions, or
production secret management.
