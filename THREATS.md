# TrustVault Threat Model

Last reviewed: 2026-10-22

This document is a living security contract for TrustVault. A feature is not
complete until its relevant threats have an enforcement point and an automated
test. The server is the final authority; hiding a button in the browser is never
considered access control.

## Security objectives

TrustVault must protect confidential documents and their metadata while still
supporting intentional sharing. It must provide:

- confidentiality: only currently authorized people can read document content;
- integrity: unauthorized people cannot alter documents, permissions, or logs;
- availability: legitimate users can use the system within the limits of the
  selected free hosting services;
- accountability: allowed and refused sensitive actions leave useful evidence;
- immediate revocation: a revoked permission fails on the next server request;
- least privilege: every role and document permission grants only what it says.

## Assets and trust boundaries

Protected assets include document bytes, document metadata, user identities,
sessions, roles, permission grants, audit events, audit-chain secrets, storage
credentials, database credentials, and administrator override reasons.

Trust boundaries exist between:

1. the browser and the Next.js server;
2. unauthenticated and authenticated requests;
3. ordinary users and administrators;
4. the application server and Supabase PostgreSQL;
5. the application server and private Cloudflare R2 storage;
6. current database authorization state and any cached or previously issued data;
7. application audit records and independently stored audit checkpoints.

## Authorization contract

The server evaluates identity, account role, document ownership, active grants,
requested action, and document state on every protected request. Access is denied
unless an explicit rule allows it.

| Actor | Read | Edit | Delete | Grant or revoke | View audit |
| --- | --- | --- | --- | --- | --- |
| Document owner | Yes | Yes | Yes | Yes | Own document |
| User with active `READ` grant | Yes | No | No | No | No |
| User with active `EDIT` grant | Yes | Yes | No | No | No |
| Unrelated user | No | No | No | No | No |
| Administrator | Only through audited override | No by role alone | No by role alone | No by role alone | System activity |

Administrator content access uses an explicit `ADMIN_OVERRIDE_READ` operation.
It requires a non-empty reason, rechecks the administrator role server-side, and
creates an audit event visible to administrators and the document owner. The
administrator role never silently implies edit, delete, or sharing authority.

## Threat register

Each identifier is stable and will be referenced by automated tests.

### Identity and session threats

#### TV-001: Unauthenticated access

- Attack: call document, permission, search, download, or audit endpoints without
  a valid session.
- Control: server-side session verification on every protected route; deny by
  default.
- Test: each protected endpoint returns an authentication error without a session.

#### TV-002: Session theft or fixation

- Attack: reuse a stolen, predictable, or attacker-selected session identifier.
- Control: Better Auth database sessions, secure and HTTP-only cookies in
  production, same-site protection, secret rotation procedure, and session
  invalidation after security-sensitive account changes.
- Test: invalid and expired sessions are rejected; authentication cookies have
  the expected production attributes.

#### TV-003: Role manipulation

- Attack: send `role: ADMIN` from the browser or modify client state to reveal
  administrator functions.
- Control: roles come only from trusted database state; role changes use a
  separately authorized server operation; request bodies cannot set their own
  effective role.
- Test: ordinary users cannot elevate themselves through any user update route.

### Object authorization threats

#### TV-004: Insecure direct object reference

- Attack: replace a document ID with another user's ID in view, metadata,
  download, edit, or delete requests.
- Control: load the document and active permission for the authenticated actor in
  the same server authorization path before returning or changing anything.
- Test: adversarial owner-A/viewer-B/unrelated-C scenarios cover every document
  endpoint.

#### TV-005: Permission escalation

- Attack: a viewer changes their `READ` grant to `EDIT`, grants another person,
  or uses an edit endpoint directly.
- Control: only the owner may manage grants; grant type and recipient are
  validated; edit authorization is independently checked on the server.
- Test: `READ` users cannot edit or manage permissions, and `EDIT` users cannot
  manage permissions or delete.

#### TV-006: Stale access after revocation

- Attack: continue reading with a previously opened page, cached authorization,
  reusable download URL, or storage URL after the owner revokes access.
- Control: check current database permission on every content request; stream
  bytes through the application; do not issue reusable public or presigned GET
  URLs; use `Cache-Control: no-store` for protected content.
- Test: a successful read followed by revocation fails on the very next request.

#### TV-007: Overpowered administrator

- Attack: use the administrator role to silently browse, edit, delete, or share
  every confidential document.
- Control: normal document permissions still apply; exceptional viewing requires
  the dedicated reason-bearing, audited override; other powers require explicit
  future policies.
- Test: administrator normal reads fail without permission, override reads are
  logged with a reason, and edit/delete/grant requests fail without document
  authorization.

#### TV-008: Enumeration through search or errors

- Attack: discover confidential filenames, owners, categories, dates, IDs, or
  existence through global search, counts, timing, or different error messages.
- Control: search is scoped to owned or actively shared documents before filters
  are applied; inaccessible objects use non-revealing responses.
- Test: unrelated documents never appear in search and inaccessible IDs do not
  reveal sensitive metadata.

### Document and storage threats

#### TV-009: Malicious or invalid upload

- Attack: upload an executable, oversized payload, misleading extension, path
  traversal name, polyglot, or unsupported file.
- Control: strict size allowlist, safe generated object keys, normalized display
  names, extension and detected MIME checks, server-side limits, and later malware
  scanning when an operational scanner is available.
- Test: unsupported, oversized, empty, double-extension, and mismatched-content
  samples are rejected.

#### TV-010: Public storage exposure

- Attack: fetch an R2 object directly, list the bucket, guess an object key, or
  retain a long-lived link.
- Control: private bucket, unguessable generated keys, credentials only on the
  server, public access disabled, and authenticated application streaming.
- Test: storage configuration checks plus application tests that never expose a
  bucket URL or object key as a downloadable link.

#### TV-011: Unauthorized modification or deletion

- Attack: bypass the interface and call update/delete routes as a viewer or
  unrelated user.
- Control: action-specific authorization immediately before the transaction;
  owner-only delete; edit grants permit content/metadata edits but not deletion.
- Test: the full role-permission matrix is exercised against both metadata and
  file-content operations.

#### TV-012: Partial database/storage failure

- Attack or failure: create orphaned R2 objects, metadata pointing to missing
  bytes, or incomplete audit evidence during upload/delete failure.
- Control: staged operations, compensating cleanup, explicit failure states, and
  audit outcomes; deletion initially uses recoverable soft-delete semantics.
- Test: injected storage and database failures leave a consistent, detectable
  state and do not grant access.

#### TV-013: Confidential data cached by intermediaries

- Attack: retrieve protected bytes or metadata from a browser, proxy, or CDN cache
  after logout or revocation.
- Control: `private, no-store` response policy for protected content and metadata;
  no public CDN route for document bytes.
- Test: sensitive responses contain the required cache headers.

### Audit threats

#### TV-014: Missing security evidence

- Attack: perform reads, downloads, edits, deletes, sharing changes, override
  access, or refused attempts without leaving a record.
- Control: sensitive services emit audit events inside the relevant workflow;
  allowed and denied outcomes use a defined event taxonomy.
- Test: every protected action produces the expected success or denial event.

#### TV-015: Audit-log tampering

- Attack: edit, delete, reorder, or insert audit rows to hide activity.
- Control: append-only application API; no update/delete audit route; each event
  stores a keyed hash linked to the prior event; periodic chain head checkpoints
  are written to a separate locked R2 location.
- Test: mutation tests alter, remove, insert, and reorder audit records and require
  verification to fail.

#### TV-016: Sensitive data leaked into logs

- Attack: recover document content, passwords, session cookies, secrets, or raw
  credentials from application or audit logs.
- Control: structured allowlisted audit metadata, secret redaction, no document
  bytes or authentication tokens in logs, and sanitized error reporting.
- Test: representative audit payloads and application errors contain no known
  secret or document body.

#### TV-017: Audit actor spoofing

- Attack: provide a forged actor ID, IP, outcome, or administrator reason in the
  request body.
- Control: actor and outcome are derived server-side; request context supplies
  network metadata; override reason is validated but recorded as user input.
- Test: supplied actor/outcome fields are ignored or rejected.

### Web and operational threats

#### TV-018: Cross-site request forgery

- Attack: trick a signed-in user into changing a document or permission.
- Control: same-site cookies, origin checks for state-changing requests, and the
  authentication framework's CSRF protections.
- Test: state-changing requests from an untrusted origin are rejected.

#### TV-019: Cross-site scripting and unsafe rendering

- Attack: inject script through filenames, categories, descriptions, audit
  reasons, or document preview content.
- Control: React escaping, schema validation, plain-text rendering for user
  metadata, nonce-based Content Security Policy on dynamic application pages,
  safe content disposition, and no inline rendering of active file types in v1.
- Test: a stored event-handler payload renders as text under a policy without
  `unsafe-inline`, and downloads use safe headers.

#### TV-020: Injection and mass assignment

- Attack: inject database expressions or unexpected fields into filters and
  updates.
- Control: Prisma parameterization, explicit validation schemas, allowlisted sort
  and filter values, and service-level DTOs.
- Test: injection strings and extra privileged fields do not change query meaning
  or protected state.

#### TV-021: Brute force and resource exhaustion

- Attack: flood login, upload, search, download, or audit endpoints and exhaust a
  free-tier instance or storage quota.
- Control: bounded request sizes and pagination, rate limits on high-risk routes,
  authentication throttling, timeouts, and quota monitoring.
- Test: rate-limited routes return a controlled response and pagination limits
  cannot be bypassed.

#### TV-022: Secret or configuration exposure

- Attack: obtain database, authentication, audit, or R2 credentials from Git,
  browser bundles, errors, or deployment output.
- Control: server-only environment variables, committed placeholder example,
  secret scanning, no `NEXT_PUBLIC_` secret names, and documented rotation.
- Test: repository and built client assets are scanned for seeded test secrets.

#### TV-023: Dependency or supply-chain compromise

- Attack: exploit a vulnerable, malicious, or unexpectedly upgraded package.
- Control: committed lockfile, minimal dependencies, automated dependency review,
  routine audit, and pinned production runtime.
- Test: CI performs lockfile-based installation and dependency auditing with a
  documented triage policy.

#### TV-024: AI suggestion widens access

- Attack: an AI feature recommends or performs a broad share, role change, or
  permission action without informed owner approval.
- Control: AI output is advisory only; authorization rules are deterministic;
  every permission change requires an explicit owner action and server check.
- Test: malformed or adversarial AI output cannot call privileged permission
  services or mutate grants.

## Accepted constraints for the hackathon release

- Render's free service may sleep and cold-start; this affects availability, not
  authorization. The demo plan must warm the service before judging.
- Full malware scanning may require infrastructure beyond the free-tier project.
  Until introduced, v1 supports only a narrow passive-document allowlist and
  clearly reports that scanning is not provided.
- A single application deployment and managed database are not highly available.
  Backup/restore instructions and exportable audit evidence reduce, but do not
  eliminate, provider outage risk.
- Browser screenshots and downloaded files remain outside server control after a
  legitimate read. TrustVault prevents future server reads after revocation; it
  cannot revoke copies already obtained by an authorized person.

## Current implementation evidence

Phases 2–3 establish database controls and the authentication boundary. Phase
4 adds the centralized decision kernel, metadata routes, and owner-controlled
READ/EDIT sharing. Phase 5 adds transaction-coupled audit writing, activity
access, and chain verification. Phase 6 adds validated private content,
immutable versions, per-request delivery authorization, failure compensation,
administrator override evidence, and external chain-head checkpoints. Phase 7
adds owner-scoped categories and authorization-composed document search. Phase
9 adds shared request limits, nonce-based browser policy, provider deadlines,
adversarial Chromium journeys, and a CI security gate.

- TV-001: `/vault`, `/admin`, and `GET /api/session` validate the current
  PostgreSQL session on the server. Proxy cookie checks are explicitly
  optimistic and never the final authorization decision.
- TV-002: Better Auth generates session tokens and slow password hashes. Session
  payload cookie caching is disabled; production cookies are secure, HTTP-only,
  and same-site. Expired/missing sessions and disabled accounts are denied.
- TV-003 and TV-020: `role` is a server-owned Better Auth field with
  `input: false`. A live integration test submitted `role: ADMIN` during signup
  and confirmed that PostgreSQL stored `MEMBER`.
- TV-018: Better Auth origin checking is explicitly enabled in every environment;
  the integration test confirms an untrusted origin receives a refusal.
- TV-021: login and registration retain dedicated throttling. High-cost
  document, recipient, activity, verification, and checkpoint routes use atomic
  PostgreSQL fixed-window counters shared across application processes. The
  database test proves concurrent requests cannot exceed the allowance, the
  browser journey proves a controlled `429`, and all R2 calls have a 15-second
  abort deadline.
- TV-019: protected dynamic pages receive a per-request nonce policy without
  `unsafe-inline`; the browser journey proves a hostile stored filename remains
  text and does not create or execute an injected element.
- TV-023: GitHub Actions installs from the committed lockfile, rejects
  high-severity audit findings, applies migrations, runs unit/integration/build
  gates, and executes the adversarial Chromium journey against PostgreSQL 15.
- TV-022: runtime auth settings use server-only environment variables, the
  repository contains placeholders only, and the production build remains
  independent from live credentials without weakening runtime checks.
- TV-009: Phase 6 accepts only PDF, PNG, and JPEG up to 10 MiB, checks one safe
  extension against the declared MIME and magic bytes, rejects traversal,
  control characters, empty files, and double extensions, and calculates the
  digest server-side.
- TV-010 and TV-022: Phase 6 uses a server-only R2 adapter with no
  public-ACL or presigned-URL operation. Object keys are random and contain no
  document, owner, email, or filename data. Configuration derives an HTTPS R2
  endpoint from a validated account ID and jurisdiction, rejects placeholders,
  and documents a bucket-scoped Object Read & Write token.
- TV-014: authentication, document-metadata, permission-management, activity-
  view, and verification paths now record server-derived allowed/denied events.
  Document and permission mutations share the transaction with their audit
  write, and a live test proves the mutation rolls back when signing fails.
- TV-015: HMAC-SHA-256 events are deterministically linked under a serialized
  writer; verification detects changed fields, missing middle events, reordering,
  and unknown key versions. PostgreSQL rejects event updates/deletes. A live test
  proves concurrent writers form one valid chain. Detection of privileged tail
  truncation can be compared with Phase 6 R2 head checkpoints once production
  enables the documented indefinite bucket lock on `audit-checkpoints/`.
- TV-016: audit metadata is explicitly constructed rather than copied from
  requests, activity responses omit internal chain/network fields, and tests
  search stored payloads for representative password, cookie, and document-body
  secrets.
- TV-017: actor identity and outcome come from the server session and policy
  result. Request IDs are server-generated; IP address and user agent come from
  bounded request headers. The audit APIs accept only allowlisted filters.
- TV-004 and TV-005: the action matrix denies unrelated users and prevents READ
  or EDIT recipients from performing owner-only operations. Unit tests evaluate
  every action for owner, reader, editor, unrelated user, and administrator.
- TV-008: name, owner, category, date, state, and sort filters are joined to the
  access predicate with `AND` in one database query. Counts use the same query;
  foreign identifiers return empty results, and tests include deleted-state and
  cross-owner filter probes.
- TV-006: the server resolver selects only grants whose `revokedAt` is null and
  does not cache decisions. An isolated PostgreSQL test proves that revocation
  changes the very next download decision from allowed to denied.
- TV-007: administrators receive metadata/activity visibility but no automatic
  content, edit, delete, restore, or sharing power. Content requires the distinct
  reason-bearing `ADMIN_OVERRIDE_READ` decision.
- TV-001: every document metadata route loads the current PostgreSQL-backed
  actor and returns 401 when it is absent.
- TV-004, TV-005, and TV-011: detail and mutation services call the centralized
  action policy. PostgreSQL API tests prove READ cannot update, EDIT can update
  but cannot delete, only owners can delete/restore, and administrators cannot
  mutate by role alone.
- TV-006: metadata reads resolve only current non-revoked grants. The API test
  proves that revoking READ changes the next detail request from 200 to the
  non-revealing 404.
- TV-008: discovery access is expressed inside the PostgreSQL query before name
  search and pagination. Malformed, missing, revoked, unrelated, and otherwise
  inaccessible detail IDs share the same public 404 body.
- TV-013: all metadata responses use `Cache-Control: private, no-store` and
  `Vary: Cookie`.
- TV-018: document POST, PATCH, DELETE, and restore requests require an Origin
  matching `APP_URL`; a unit test rejects an untrusted origin.
- TV-020 and TV-021: strict schemas reject ownership/state mass assignment,
  unknown filters, path-like IDs, oversized metadata, bodies above 64 KiB, and
  pagination limits above 50.
- TV-004 and TV-005: every permission route evaluates `MANAGE_GRANTS` inside its
  transaction. PostgreSQL tests prove READ, EDIT, unrelated, and administrator
  actors cannot list, create, change, or revoke another owner's grants.
- TV-006: grant revocation preserves the row but removes it from current access
  checks. A live permission-to-document API journey proves the next metadata
  request changes from 200 to the non-revealing 404.
- TV-008: recipient discovery requires one exact valid email rather than broad
  directory search. Disabled, missing, and self-recipient cases share the same
  public response and do not expose role or account status.
- TV-017 and TV-020: strict grant schemas reject client-supplied issuer,
  recipient ID, revoker, document, and owner fields. Services derive security
  actors and outcomes from current server state.
- TV-005 and TV-020: category ownership comes only from the session. Normalized
  per-owner uniqueness is database-enforced, foreign category mutations use
  non-revealing errors, and deletion detaches rather than deletes documents.
- TV-018: grant creation, access-level replacement, and revocation require an
  Origin matching `APP_URL`.
- TV-014: permission operations now record allowed and denied outcomes through
  the transaction-coupled audit writer introduced in Phase 5.
- TV-004, TV-006, and TV-007: version history and content delivery re-read the
  current grant on each request. Revocation blocks the next request, inaccessible
  versions use non-enumerating errors, and administrators need a validated,
  audited override reason without gaining mutation powers.
- TV-012 and TV-013: upload uses explicit PENDING/READY/FAILED states and
  compensating object deletion. Content is server-proxied with private/no-store
  headers and actual-byte SHA-256 verification before delivery.

- TV-005: a partial unique PostgreSQL index permits at most one active grant per
  document and recipient while retaining revoked grants as history.
- TV-012: document versions use explicit `PENDING`, `READY`, `FAILED`, and
  `DELETED` storage states in implemented compensating workflows.
- TV-015: PostgreSQL triggers reject `UPDATE` and `DELETE` against audit events
  and checkpoints. Phase 6 writes verified chain heads to the R2 checkpoint
  prefix; independent immutability depends on the documented production bucket
  lock and remains unverified until deployment.
- TV-020: foreign keys, uniqueness rules, positive size/version checks, deletion
  consistency, revocation consistency, and hash-format checks reject malformed
  relational states independently of the browser.
- All five migrations were applied to an isolated PostgreSQL 15 instance. Live
  adversarial checks confirmed grant/content role boundaries, immediate
  revocation, collision-free concurrent version numbering, failure states,
  integrity refusal, and rejection of audit/checkpoint mutations.

## Review rule

Update this file whenever an endpoint, role, storage path, audit event, or AI
feature is added. Pull requests must name the threat IDs they address and the
tests that enforce them.
