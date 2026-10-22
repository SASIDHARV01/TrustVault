# TrustVault AI Prompt and Decision Log

This log records material AI-assisted decisions, including mistakes and the
human-reviewed correction. It is not a transcript. New entries must be dated,
specific, and linked to the commit that implements or formalizes the decision.

## 2026-10-19 — 01 — Understanding the challenge

**What was asked**

Explain the document-sharing challenge in simple language, walk through its
scenarios, provide background, compare existing solutions, and identify a
feasible hackathon approach.

**What the AI produced**

It reframed the project as a private document vault with role-based access,
per-document sharing, search, upload validation, and an audit trail. It also
identified familiar products such as Google Drive and Dropbox as useful product
references while noting that TrustVault must visibly prove its authorization and
audit behavior.

**What was weak or wrong**

The initial explanation treated the application too much like ordinary document
CRUD. It did not make the hostile cross-user scenarios, refused-action logging,
instant revocation, or audit-log mutation testing central enough.

**What we chose instead**

Security invariants and adversarial scenarios are now the foundation of the
design. Features will be accepted only when server-side authorization and the
associated negative tests exist.

**Commit evidence:** [ab16a8d](../../commit/ab16a8d)

## 2026-10-19 — 02 — Choosing the application architecture

**What was asked**

Propose the approach, architecture, workflow, implementation phases, and
technology stack, and decide whether Django or Next.js plus Node would be more
suitable.

**What the AI produced**

The advice first leaned toward Django because of its mature server features,
then moved toward a TypeScript web stack after considering the team's stated
comfort, speed, and deployment needs.

**What was weak or wrong**

Switching stacks without a fixed decision matrix created unnecessary ambiguity.
A separate Next.js frontend and Node backend was also more deployment and API
surface than this hackathon requires.

**What we chose instead**

Use one full-stack Next.js TypeScript application with the Node runtime. Keep all
authorization and data access in server-only modules and route handlers. Use
Prisma with Supabase-hosted PostgreSQL, Better Auth for database sessions, and a
private Cloudflare R2 bucket for file bytes.

**Commit evidence:** [e7a381a](../../commit/e7a381a)

## 2026-10-20 — 03 — Administrator document viewing

**What was asked**

Add document viewing for administrators while still satisfying the security
requirements.

**What the AI produced**

An early interpretation limited administrators to metadata and audit activity.
That was secure by default, but it did not satisfy the requested administrator
viewing scenario.

**What was weak or wrong**

Making administrators universal silent readers would violate least privilege and
undermine the promise that confidential documents are shared intentionally.
Removing administrator viewing entirely would miss a stated product requirement.

**What we chose instead**

Create a dedicated `ADMIN_OVERRIDE_READ` operation. It requires an administrator
session and a non-empty reason, records an audit event visible to the owner, and
grants no automatic edit, delete, or permission-management capability. Normal
document reads still follow ordinary ownership and grant rules.

**Commit evidence:** [ab16a8d](../../commit/ab16a8d)

## 2026-10-20 — 04 — Free hosting and deployment timing

**What was asked**

Avoid Railway if it is not genuinely free, use Supabase PostgreSQL instead of a
local production database, retain a Cloudflare-owned domain, and divide the work
into medium-sized phases with frequent commits.

**What the AI produced**

The first infrastructure suggestion included Railway and proposed deploying an
early skeleton. A later comparison considered Render, Vercel, Cloudflare Workers,
and managed data services.

**What was weak or wrong**

Railway's ongoing free allowance was not a dependable fit for the stated zero-
cost goal. Vercel function body limits and a Workers-first runtime would add
friction to authenticated document streaming. Deploying every partial phase was
also not the workflow the user wanted.

**What we chose instead**

Develop and verify locally in reviewable phases, then perform one deployment
phase at the end. Use Render's free web service for the Node application,
Supabase Free for PostgreSQL, Cloudflare R2 for private objects, and connect the
Cloudflare domain only after the production checks pass. Free-tier sleep and
quota limits are documented operational constraints.

**Commit evidence:** [e7a381a](../../commit/e7a381a)

## 2026-10-21 — 05 — Authorization, downloads, and audit integrity

**What was asked**

Ensure all challenge requirements are satisfied, including server authorization
on every route, immediate revocation, allowed and refused audit events, a log
that cannot be quietly altered, and automated cross-user tests.

**What the AI produced**

The design identified role checks, per-document permissions, audit rows, private
object storage, and test users. Earlier wording still left room for generic
presigned download URLs and did not define how audit tampering would be detected.

**What was weak or wrong**

A reusable storage URL can outlive a revoked database permission. Plain database
audit rows can also be modified by a sufficiently privileged database actor
without detection. Merely claiming that logs are immutable is not evidence.

**What we chose instead**

Every protected content request will recheck current database authorization and
stream private R2 bytes through the application with `no-store` caching. Audit
events will be append-only at the application boundary, linked with keyed hashes,
and periodically checkpointed to a separately locked R2 location. Tests will
mutate, remove, insert, and reorder events and require verification to fail.

**Commit evidence:** [ab16a8d](../../commit/ab16a8d)

## 2026-10-22 — 06 — Phase 1 web foundation

**What was asked**

Begin the next implementation phase while preserving the incremental workflow,
daily commits, and final-only deployment decision.

**What the AI produced**

It created the full-stack Next.js foundation, responsive public experience,
health endpoint, baseline browser security headers, TypeScript and ESLint rules,
unit-test setup, and one command for the complete local quality gate.

**What was weak or wrong**

Installing every tool at its newest release initially selected TypeScript 7,
which the TypeScript ESLint integration did not yet support. The Next.js lint
preset also introduced a development-only dependency advisory with no patched
upstream version. Finally, the first Content Security Policy blocked React's
local debugging runtime and produced a browser error overlay.

**What we chose instead**

Pin the supported TypeScript 6 and ESLint 9 major versions, replace the affected
optional Next.js lint preset with strict TypeScript-aware rules, and allow
`unsafe-eval` only while `NODE_ENV` is `development`. Production retains the
stricter policy. Lint, type-checking, tests, production build, mobile browser QA,
and the online dependency audit all passed before commit.

**Commit evidence:** [cac2115](../../commit/cac2115)

## 2026-10-22 — 07 — Phase 2 security data model

**What was asked**

Implement Phase 2 after first explaining the existing system, planned database
architecture, workflow, commits, validation, and interview reasoning.

**What the AI produced**

It added pinned Prisma 7 PostgreSQL tooling, Better Auth-compatible identity
models, document/category/version/grant models, audit events and checkpoints, a
server-only pooled runtime client, the first SQL migration, schema-contract tests,
and database architecture documentation.

**What was weak or wrong**

Using `prisma@latest` would have selected a Prisma 8 release candidate while the
stable client remained on Prisma 7. Prisma's schema language also cannot express
the partial unique index and append-only triggers required by TrustVault. The
earlier Phase 2 outline proposed seed users before authentication existed, which
would have encouraged direct password/account insertion outside Better Auth.

**What we chose instead**

Pin Prisma CLI, client, and PostgreSQL adapter to stable 7.10.1. Add the active-
grant constraint, consistency checks, hash checks, and audit immutability triggers
in reviewed migration SQL. Defer credential-bearing seeds until Better Auth can
create them correctly. Apply the migration to isolated PostgreSQL 15 and run live
adversarial statements proving that invalid grants, deletion state, hashes, and
audit mutations are rejected.

**Commit evidence:** [a7cad29](../../commit/a7cad29), [354b4bd](../../commit/354b4bd)

## 2026-10-22 — 08 — Phase 3 authentication boundary

**What was asked**

Implement all authentication work on a dedicated `authentication` branch,
explain the phase for interview preparation, validate it, and show every file and
proposed commit before committing or pushing.

**What the AI produced**

It added Better Auth credentials and PostgreSQL sessions, login and registration
screens, protected member/admin routes, disabled-account checks, throttling,
demo-user seeding, unit/integration tests, and responsive browser-verified UI.

**What was weak or wrong**

The first disabled-account hook queried outside Better Auth's signup transaction
and could not see the uncommitted new user, so it rejected valid registration.
The first browser preview also showed that a not-yet-hydrated form could fall
back to GET and expose test credentials in the URL. Finally, Better Auth disables
origin checks automatically in test mode unless configured otherwise.

**What we chose instead**

Rely on the session foreign key for nonexistent users and reject only an existing
user with `disabledAt`. Make both credential forms POST even before hydration.
Explicitly enable origin validation in every environment, and prove mass-
assignment rejection, password hashing, secure cookies, PostgreSQL sessions,
untrusted-origin refusal, and disabled-account refusal against isolated
PostgreSQL.

**Commit evidence:** [f2d2afe](../../commit/f2d2afe), [43a0842](../../commit/43a0842), [7eafd92](../../commit/7eafd92)

## 2026-10-22 — 09 — Phase 4.1 document authorization kernel

**What was asked**

After merging authentication, begin the document-authorization phase in medium,
reviewable work while explaining the existing system, next implementation,
workflow, and commits before committing.

**What the AI produced**

It introduced a centralized action-based permission policy, server-only current-
grant lookup, stable allow/deny reasons, administrator override validation,
exhaustive role-matrix tests, a live PostgreSQL revocation test, and authorization
architecture documentation.

**What was weak or wrong**

A simplistic role check would have made administrators universal readers or
allowed READ/EDIT grants to inherit owner powers. A cached permission result
would also contradict immediate revocation, while returning detailed deny
reasons to clients would help attackers enumerate documents.

**What we chose instead**

Evaluate one explicit action using server-derived ownership, current active
grant, document state, and system role. Keep administrator content access in a
separate reason-bearing override, query `revokedAt: null` on every request, deny
by default, and reserve detailed decision reasons for services and audit records.

**Commit evidence:** [1c9fdc3](../../commit/1c9fdc3), [f3eafe7](../../commit/f3eafe7)

## 2026-10-22 — 10 — Phase 4.2 authorized document metadata APIs

**What was asked**

Build all Phase 4.2 parts together: API security helpers, authorized discovery,
metadata creation/detail/update/delete/restore, and adversarial API tests.

**What the AI produced**

It added strict request schemas, session-derived API actors, trusted-origin
checks, request IDs, database-scoped discovery, authorization-aware transactional
services, Next.js route handlers, non-enumerating errors, focused unit tests,
live PostgreSQL adversarial journeys, and an API security contract.

**What was weak or wrong**

The first paginated-list implementation used Prisma's array transaction form.
Although tests passed, the PostgreSQL driver emitted a future-compatibility
warning. More importantly, filtering document rows after fetching them or
trusting owner/state fields from JSON would have created authorization and mass-
assignment vulnerabilities.

**What we chose instead**

Apply discovery conditions inside PostgreSQL before search and pagination,
derive actor and ownership from the current session, reject unknown JSON fields,
use repeatable-read/serializable transactions for authorized operations, and
return the same public result for malformed, missing, revoked, and inaccessible
document identifiers. Paginated reads are sequential inside one transaction;
the remaining warning traces to the pinned Prisma adapter's transaction I/O.

**Commit evidence:** [27efc0c](../../commit/27efc0c), [b79f999](../../commit/b79f999), [d87c596](../../commit/d87c596)

## 2026-10-22 — 11 — Phase 4.3 owner-controlled document sharing

**What was asked**

Implement the complete Phase 4.3 permission-management phase at once, including
recipient discovery, grant services, HTTP routes, security tests, and docs.

**What the AI produced**

It added exact-email eligible-recipient lookup, owner-only grant history,
READ/EDIT creation, history-preserving access replacement, soft revocation,
strict HTTP handlers, nested Next.js routes, focused tests, live PostgreSQL
adversarial journeys, and a permission security contract.

**What was weak or wrong**

Updating an access-level column in place would erase evidence of what permission
existed previously. Broad recipient search would expose the user directory, and
allowing administrator role alone to manage sharing would contradict least
privilege. Permission routes without an audit writer are also not yet production
complete.

**What we chose instead**

Require one exact normalized email, hide disabled/self/missing distinctions,
derive all security actors server-side, authorize only the owner through
`MANAGE_GRANTS`, and replace access atomically by revoking the prior row before
creating its successor. Keep request IDs ready for audit correlation and record
the audit writer as an explicit remaining production dependency.

**Commit evidence:** [26e9795](../../commit/26e9795), [8bb5977](../../commit/8bb5977), [8dc4e0f](../../commit/8dc4e0f)

## 2026-10-22 — 12 — Phase 5 tamper-evident audit trail

**What was asked**

Continue from the completed document-authorization phase and implement the next
phase while preserving the explain-before-commit workflow.

**What the AI produced**

It added versioned HMAC-SHA-256 event chaining, serialized PostgreSQL writers,
transaction-coupled document and permission auditing, authentication events,
owner/admin activity endpoints, administrator chain verification, strict query
filters, unit tests, live adversarial PostgreSQL tests, and the audit security
contract.

**What was weak or wrong**

The first verifier accidentally passed the database-only `BigInt` row ID into
the canonical JSON payload, which both changed the signed shape and could not be
serialized. The first concurrent writer relied on serializable isolation without
retrying PostgreSQL conflicts. The original audit foreign keys used `ON DELETE
SET NULL`, but nulling a relation would update a row that the immutability trigger
correctly rejects.

**What we chose instead**

Reconstruct the exact allowlisted signed payload during verification, use a
transaction advisory lock plus shared bounded serialization retry, and restrict physical
deletion of referenced actors/documents while retaining account disable and
document soft deletion. Add a live rollback test proving a protected mutation
cannot commit when its audit signature cannot be created. Document honestly that
an independent R2 chain-head checkpoint is still required to detect privileged
tail truncation.

**Commit evidence:** pending Phase 5 commits

## Entry template

Copy this section for future material AI use:

```markdown
## YYYY-MM-DD — NN — Decision title

**What was asked**

**What the AI produced**

**What was weak or wrong**

**What we chose instead**

**Commit evidence:** [short-sha](../../commit/full-sha)
```
