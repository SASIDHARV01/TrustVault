# TrustVault Document Authorization

Last verified: 2026-10-22

## Purpose

Authentication answers who is making a request. Document authorization answers
whether that authenticated person may perform one specific action on one
specific document right now.

Phase 4.1 introduces a single deny-by-default policy in
`src/lib/document-authorization.ts` and a server-only PostgreSQL resolver in
`src/lib/server/document-authorization.ts`. Future document routes must use this
boundary instead of writing their own role checks.

## Authorization inputs

Every decision uses trusted server data:

- authenticated actor ID and current system role;
- document owner ID and active/deleted state;
- the actor's current non-revoked document grant, if one exists;
- requested action;
- a validated administrator override reason only for the dedicated override.

Document IDs, role names, outcomes, owner IDs, and grant levels supplied by a
browser are never treated as authorization facts.

## Action policy

### Document owner

For an active owned document, the owner may discover it, view metadata, preview,
download, update metadata, create a version, delete it, manage grants, and view
its activity. The owner may inspect and restore their deleted document.

### Active READ grant

The recipient may discover the active document, view metadata, preview, and
download. They cannot update metadata, create a version, delete, restore, manage
grants, or view the owner's document activity.

### Active EDIT grant

The recipient receives every READ capability plus metadata updates and immutable
version creation. EDIT still does not permit delete, restore, grant management,
or document-activity access.

### Unrelated user

No document action is allowed. Future routes must return the same non-revealing
response used for a missing document so IDs cannot be used for enumeration.

### Administrator

An administrator may discover documents, view system-wide metadata, and review
activity. The role alone does not permit ordinary preview, download, metadata
editing, version creation, deletion, restoration, or grant management.

Content access uses the distinct `ADMIN_OVERRIDE_READ` action. It requires a
trimmed operational reason of 10–500 characters and will later create a
high-visibility audit event. A deleted document cannot be read through an
override. An administrator who independently owns a document or holds a grant
may use that ordinary relationship without an override.

## Deleted-document policy

Deletion suspends every READ and EDIT grant. The owner may inspect metadata,
review activity, and restore. Administrators may inspect metadata and activity
but cannot restore or read content. Other actions fail with a stable internal
deny reason.

## Database resolution and immediate revocation

The resolver performs one narrow query for the document and only the current
actor's grant where `revokedAt` is null. It does not load other recipients and it
does not cache authorization decisions.

A grant revoked between requests is absent from the next resolver query. The
PostgreSQL integration test proves that a successful download decision followed
by revocation becomes a denial on the next call.

Future content reads must call this resolver immediately before opening private
R2 bytes. Future writes must repeat authorization inside the same database
transaction as the mutation. A prior page render or authorization result must
never be reused as permission.

## Stable internal reasons

Allowed decisions distinguish owner, READ grant, EDIT grant, administrator
metadata, administrator activity, and administrator override paths. Denied
decisions distinguish missing/deleted/active state, owner/admin requirements,
missing override, missing active grant, and insufficient grant level.

These reasons are for service logic and audit evidence. Routes must map missing
and inaccessible document decisions to the same client-facing response instead
of exposing why access failed.

## Future route mapping

- List/search routes use `DISCOVER` semantics in their database filters.
- Metadata detail uses `VIEW_METADATA`.
- Preview and streamed content use `PREVIEW` or `DOWNLOAD`.
- Metadata mutation uses `UPDATE_METADATA`.
- New immutable content uses `CREATE_VERSION`.
- Soft deletion and recovery use `DELETE` and `RESTORE`.
- Sharing changes use `MANAGE_GRANTS`.
- Owner/admin activity views use `VIEW_ACTIVITY`.
- Exceptional administrator content access uses `ADMIN_OVERRIDE_READ` only.

## Phase boundary

Phase 4.1 implements and verifies the authorization kernel. It does not yet add
document HTTP routes, user-facing document screens, permission mutations, R2
storage, or audit-chain writes. Those consumers will be built in later reviewed
sub-phases and must call this kernel.

Phase 4.2 now uses the kernel for document metadata detail, update, deletion, and
restoration. Its list service expresses equivalent discovery rules directly in
the PostgreSQL query so inaccessible rows are never fetched. See
`docs/API_AUTHORIZATION.md` for the HTTP contract. Permission mutations, R2
content operations, user-facing document screens, and audit-chain writes remain
outside this phase.

Phase 4.3 now uses `MANAGE_GRANTS` for owner-only grant listing, creation,
READ/EDIT replacement, and revocation. See `docs/PERMISSIONS.md`. R2 content
operations, user-facing document screens, and audit-chain writes remain outside
the completed authorization phases.

## Verification

The unit suite exhaustively evaluates active owner, READ, EDIT, unrelated,
administrator, administrator-with-grant, and deleted-document scenarios across
all actions. It also checks deny reasons and override-reason validation.

The opt-in PostgreSQL test creates real users, a document, active READ/EDIT
grants, and a revoked grant. It verifies the role matrix, administrator boundary,
and next-query revocation behavior:

```bash
TEST_DATABASE_URL=postgresql://... npm test -- tests/document-authorization.integration.test.ts
```
