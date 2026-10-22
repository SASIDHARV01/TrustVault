# TrustVault Document Organization and Search

Last verified: 2026-10-22

## Phase 7 scope

Phase 7 adds owner-managed categories and authorization-scoped document search.
It extends the existing document listing path instead of introducing a separate
search service, so discovery and ordinary lists share one database access rule.
No category or search screen is included yet; those belong to the frontend
phase.

## Owner-scoped categories

Authenticated users manage only categories they own:

- `GET /api/categories` lists the current user's categories;
- `POST /api/categories` creates a category from `{ "name": "Finance" }`;
- `PATCH /api/categories/:categoryId` renames an owned category; and
- `DELETE /api/categories/:categoryId` deletes an owned category.

System administrators do not receive automatic authority over another person's
categories. A malformed, missing, or foreign category ID produces the same
non-revealing `CATEGORY_NOT_FOUND` response. Mutations require a trusted origin,
strict JSON, and a current database-backed session.

Names are Unicode NFKC-normalized, trimmed, and collapsed to single spaces.
Uniqueness is case-insensitive within one owner through the existing
`(ownerId, normalizedName)` database constraint. Different owners may use the
same display name. Control characters, empty names, names over 80 characters,
and client-supplied owner fields are rejected.

Deleting a category does not delete documents. PostgreSQL atomically sets their
`categoryId` to null. Responses report only the number of active documents that
were detached. Allowed and denied create/update/delete decisions are written as
`CATEGORY_*` audit events without storing category names.

## Authorization-scoped search

`GET /api/documents` supports these allowlisted parameters:

- `q`: case-insensitive document-name text;
- `owner`: case-insensitive owner name or email text;
- `ownerId`: exact owner identifier;
- `category`: case-insensitive category-name text;
- `categoryId`: exact category identifier;
- `createdFrom` and `createdTo`: ISO 8601 timestamps with offsets;
- `state`: `ACTIVE` or `DELETED`;
- `sort`: `createdAt`, `updatedAt`, or `name`;
- `order`: `asc` or `desc`;
- `page`: one-based page; and
- `limit`: 1–50.

The server constructs one Prisma `AND` expression containing document state,
the actor's access predicate, and every requested filter. This prevents a filter
from overwriting authorization. For active documents, ordinary users see only
owned documents or documents with a current READ/EDIT grant. For deleted
documents, ordinary users see only their own. Administrators may search all
metadata but gain no content or mutation power.

Text searches run only across already-authorized document rows. Owner/category
matches therefore cannot be used as a global user-directory or category oracle.
Unknown owner/category IDs return an empty collection rather than confirming
whether the target exists. Pagination count uses exactly the same predicate as
the returned rows, preventing count-based leakage.

## Verification evidence

Unit and handler tests cover normalization, strict schemas, invalid date ranges,
bounded pagination, allowlisted sorting, mass assignment, trusted origins,
private response headers, stable conflicts, and non-enumerating errors.

The isolated PostgreSQL 15 suite proves:

- equivalent normalized category names conflict only for the same owner;
- lists contain only the authenticated owner's categories;
- unrelated users and administrators cannot mutate another owner's category;
- deletion safely detaches documents;
- allowed and denied category mutations are audited without storing names;
- name, owner, category, date, sorting, and access filters compose correctly;
- readers cannot filter their way into unrelated documents; and
- a deleted-state owner filter cannot overwrite the owner-only access rule.
