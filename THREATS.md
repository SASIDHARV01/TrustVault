# TrustVault Threat Model

Last reviewed: 2026-10-21

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
  metadata, safe content disposition, and no inline rendering of active file
  types in v1.
- Test: stored script payloads render as text and downloads use safe headers.

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

## Review rule

Update this file whenever an endpoint, role, storage path, audit event, or AI
feature is added. Pull requests must name the threat IDs they address and the
tests that enforce them.
