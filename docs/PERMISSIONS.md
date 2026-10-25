# TrustVault Permission Management

Last verified: 2026-10-25

## Phase 4.3 scope

Phase 4.3 implements named-user READ and EDIT sharing. It adds exact-email
recipient lookup, owner-only grant listing, creation, access-level changes, and
revocation. All decisions remain server-side and use the Phase 4.1
`MANAGE_GRANTS` policy.

Permission audit event types and append-only tables already exist, but the
tamper-evident audit writer is not implemented in this phase. The permission
routes must not be described as production-ready until that writer records
allowed and denied sharing operations.

## Recipient lookup

`GET /api/recipients?email=user@example.com` performs an exact normalized-email
lookup. It does not provide substring search or a browsable company directory.

Only an authenticated user may call it. Results include the eligible user's ID,
name, and email but omit system role, account status, sessions, and credentials.
A caller cannot select themselves, and disabled, missing, and self matches share
the same `RECIPIENT_NOT_FOUND` result.

Exact lookup reduces directory enumeration compared with broad name/email
search. Endpoint rate limiting remains required before production deployment.

## Permission endpoints

### `GET /api/documents/:documentId/grants`

Returns active and revoked grant history to the document owner. READ/EDIT
recipients, unrelated users, and administrators receive the same non-revealing
document response used for inaccessible metadata.

Each lifecycle includes a server-derived access summary: first/latest use,
successful operation counts, revocation identity/time, and blocked attempts
after revocation. Re-granting the same recipient creates a new lifecycle window;
events are never reassigned across that boundary.

### `GET /api/admin/access`

Returns the same evidence across all documents only to administrators. Search is
bounded to document, owner, and recipient identity; optional status and access
level filters are allowlisted. Reading the report itself produces an
`AUDIT_VIEW` event. This visibility does not grant administrators authority to
edit, delete, share, or silently read document content.

### `POST /api/documents/:documentId/grants`

Creates one active READ or EDIT grant for an exact eligible email address. The
server derives the document, issuer, recipient, and timestamps. Request JSON
cannot supply IDs for the issuer, recipient, revoker, or owner.

The database partial unique index permits at most one active grant per document
and recipient. The service checks first for a friendly conflict, and the index
still protects concurrent requests.

### `PATCH /api/documents/:documentId/grants/:grantId`

Changes READ to EDIT or EDIT to READ. It does not overwrite the existing row.
Inside one serializable transaction, TrustVault:

1. reauthorizes the owner;
2. marks the current grant revoked by that owner;
3. creates a replacement active grant with the new access level.

This preserves the old authorization state for investigation and future audit
correlation. Requesting the existing level returns `GRANT_UNCHANGED` without
modifying data.

### `DELETE /api/documents/:documentId/grants/:grantId`

Revokes an active grant by setting `revokedAt` and `revokedById`. The row is
preserved. Because all document authorization queries require `revokedAt` to be
null, the recipient is denied on the next protected request.

## Security properties

- Every grant route resolves the current PostgreSQL-backed session.
- `MANAGE_GRANTS` is evaluated inside the same transaction as each change.
- Only the document owner passes `MANAGE_GRANTS`; ADMIN does not imply ownership.
- Grant changes use serializable transactions; history listing uses a
  repeatable-read transaction.
- Disabled users and the document owner cannot become recipients.
- Strict schemas allow only email and READ/EDIT input fields.
- Mutation origins must match `APP_URL`.
- JSON request bodies are streamed with a 64 KiB maximum.
- Responses are private, non-cacheable, and carry an `X-Request-ID`.
- Permission history never includes document bytes, storage keys, passwords,
  sessions, or authorization-policy reasons.

## Verification

Focused tests cover exact-email validation, normalization, role/issuer/revoker
mass assignment, path-like IDs, authentication, origin checks, safe errors, and
duplicate-grant conflicts.

The PostgreSQL suite drives both permission and existing document API handlers.
It proves owner-only management, administrator denial, recipient eligibility,
duplicate rejection, non-destructive READ/EDIT changes, preservation of revoked
rows, and immediate loss of metadata access after revocation:

```bash
TEST_DATABASE_URL=postgresql://... npm test -- tests/permission-api.integration.test.ts
```

