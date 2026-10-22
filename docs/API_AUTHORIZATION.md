# TrustVault Document Metadata API

Last verified: 2026-10-22

## Phase 4.2 scope

Phase 4.2 connected authenticated HTTP requests to the centralized document
authorization kernel. It provides metadata creation, discovery, inspection,
update, soft deletion, and restoration. Phase 6 adds the content endpoints below;
grant management and audit APIs are documented separately.

Every response is private and non-cacheable and includes an `X-Request-ID`
header. The identifier will correlate these operations with audit events when
the audit writer is introduced.

## Endpoints

### `GET /api/documents`

Returns only metadata the authenticated actor may discover. The database query
applies access conditions before search and pagination; unauthorized rows are
never loaded and filtered in application memory.

Supported query parameters:

- `q`: optional case-insensitive document-name search;
- `owner` or `ownerId`: owner text or exact owner filter;
- `category` or `categoryId`: category text or exact category filter;
- `createdFrom` and `createdTo`: inclusive ISO 8601 date range;
- `state`: `ACTIVE` by default or `DELETED`;
- `sort`: `createdAt`, `updatedAt`, or `name`;
- `order`: `asc` or `desc`;
- `page`: one-based page number;
- `limit`: 1–50, default 20.

Ordinary users see active documents they own or hold a current READ/EDIT grant
for. Deleted-document grants are suspended, so ordinary users see only their own
deleted documents. Administrators may list metadata for active or deleted
documents but receive no content or mutation authority from that visibility.
Every requested filter is combined with this access predicate using `AND`;
filters cannot replace or weaken authorization. Counts use the identical query.

### `POST /api/documents`

Creates an active metadata record owned by the authenticated actor. Accepted
fields are `name`, optional `description`, and optional `categoryId`. Ownership,
state, deletion fields, and timestamps cannot be supplied by a browser. A
category is accepted only when it belongs to the new document owner.

This creates metadata only. Upload the first immutable version through the
versions endpoint after this record is created.

### `GET|POST /api/documents/:documentId/versions`

`GET` lists READY immutable versions after a current metadata authorization
check. `POST` accepts one validated multipart `file` from the owner or an active
EDIT recipient. Both paths re-read authorization; the response omits object
keys and provider details.

### `GET /api/documents/:documentId/versions/:versionId/content`

Streams verified private bytes after a current PREVIEW or DOWNLOAD decision.
Use `?disposition=attachment` for download. Administrators without a normal
grant must supply a valid `X-TrustVault-Override-Reason`; the override is audited
and never grants mutation power.

### `GET /api/documents/:documentId`

Returns authorized metadata. The server loads the current document state and
active grant and evaluates `VIEW_METADATA`. A missing document, malformed ID,
revoked grant, and inaccessible document all produce the same response:

```json
{
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "Document not found."
  }
}
```

### `PATCH /api/documents/:documentId`

Updates allowlisted metadata after evaluating `UPDATE_METADATA` in the same
database transaction. Owners and active EDIT recipients may change the name,
description, or category. READ recipients, unrelated users, and administrators
without an independent EDIT relationship are denied. A category must belong to
the document owner, including when an editor performs the update.

### `DELETE /api/documents/:documentId`

Performs owner-only recoverable deletion. The same serializable transaction
rechecks `DELETE` and sets the state, deletion timestamp, and deleting actor.
Document and version rows are not physically removed.

### `POST /api/documents/:documentId/restore`

Restores an owner’s deleted document after evaluating `RESTORE`. Administrators,
READ/EDIT recipients, and unrelated users cannot restore it.

## HTTP security boundary

- Authentication is resolved from the current PostgreSQL-backed session; actor
  IDs and roles in request bodies are rejected as unknown fields.
- State-changing requests require an `Origin` matching `APP_URL` in addition to
  same-site session cookies.
- JSON bodies are limited to 64 KiB and require an application/json content type.
- Zod schemas reject unknown fields, oversized values, unsupported filters, and
  pagination above 50 rows.
- Prisma parameterizes database values.
- Mutations authorize and write inside a serializable transaction.
- Detail reads use a repeatable-read transaction.
- Missing and inaccessible document responses are deliberately indistinguishable.
- Responses use `Cache-Control: private, no-store` and `Vary: Cookie`.

## Response shape

Successful responses wrap results in `data`. Errors expose a stable public code
and safe message under `error`. Internal policy reasons such as
`DENY_NO_ACTIVE_GRANT` never leave the service boundary.

Metadata responses may include the document ID, name, description, state,
effective access relationship, owner identity, category, and timestamps. They do
not include storage keys, version hashes, other recipients, internal policy
reasons, or document bytes.

## Verification

Pure tests verify strict schemas, bounded pagination, path-like ID rejection,
mass-assignment rejection, origin enforcement, cache headers, request IDs, and
non-revealing errors.

The opt-in PostgreSQL suite drives the HTTP handlers through real services. It
proves database-scoped discovery, READ/EDIT/owner/admin mutation boundaries,
deleted-document behavior, category ownership, identical missing/inaccessible
responses, and next-request revocation:

```bash
TEST_DATABASE_URL=postgresql://... npm test -- tests/document-api.integration.test.ts
```

