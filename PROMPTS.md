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
