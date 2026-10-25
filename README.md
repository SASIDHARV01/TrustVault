# TrustVault

TrustVault is a security-first document-sharing platform where access is granted to named people per document, revoked access stops working on the next request, and both successful and rejected actions are preserved in a tamper-evident audit trail.

## Project status

TrustVault is a complete hackathon release for the Snovyasys document-security
challenge. It was built incrementally, with each security phase validated and
committed before the next phase. The production application uses Vercel with a
Cloudflare-managed custom domain:

**Production:** https://trust-vault.aquaries.dev

Phases 0–7 currently provide the security contract, public web foundation,
validated PostgreSQL data model, Better Auth credentials and sessions, protected
member/admin routes, repeatable demo identities, centralized per-document
authorization, authorized document metadata APIs, and owner-controlled named-user
READ/EDIT sharing. Phase 5 adds transaction-coupled allowed/denied audit events,
an HMAC-linked append-only chain, owner/admin activity APIs, and administrator
integrity verification. Phase 6 completes private R2-backed uploads, immutable
versions, authorized preview/download, immediate content revocation, audited
administrator override, failure compensation, actual-byte SHA-256 verification,
and locked-prefix audit checkpoints. Phase 7 adds audited owner-scoped category
management and database-authorized search by name, owner, category, date, state,
and safe sort/pagination fields. Phase 8 adds responsive member and administrator
workspaces for those capabilities. Phase 9 adds shared PostgreSQL-backed request
limits, nonce-based browser policy, provider timeouts, adversarial browser
journeys, and an automated security quality gate. Live R2 verification and
deployment verification are now part of Phase 10.

## Security invariants

These rules are part of the product contract, not optional implementation details:

1. The server authenticates and authorizes every protected request.
2. Authorization defaults to deny when no explicit rule allows an action.
3. A document identifier, URL, UI state, or hidden button never grants access.
4. List and search queries return only documents the requester may discover.
5. Document bytes remain in private object storage and are served only after a current authorization decision.
6. Revocation is effective for the next metadata, preview, download, version, or mutation request; permission decisions are not cached.
7. Successful and refused security-sensitive actions are audited.
8. Audit events are append-only and cryptographically linked so modification or deletion is detectable.
9. AI may suggest access recipients but can never grant or widen access without human confirmation.

## Roles and permissions

### Administrator

An administrator can review system-wide document metadata, inspect audit activity, verify audit integrity, and use an explicit privileged document-viewing flow. Privileged viewing requires a reason and creates a high-visibility `ADMIN_OVERRIDE_READ` event. It does not grant edit, delete, ownership, permission-management, or user-lifecycle rights.

### Document owner

An owner can upload documents, manage metadata and categories, create versions, grant or revoke named-user access, delete or recover owned documents, and inspect activity for owned documents.

### Viewer

A viewer can access only documents covered by a current named-user grant:

- `READ`: discover metadata, preview, and download.
- `EDIT`: all `READ` actions plus creating a new immutable version.

`EDIT` never permits deletion, recovery, ownership transfer, or permission management.

## Architecture

- Full-stack Next.js with TypeScript and the Node.js runtime
- Better Auth with PostgreSQL-backed sessions
- Supabase-hosted PostgreSQL with Prisma migrations
- Private Cloudflare R2 document storage
- Vercel Fluid Compute for the full-stack Next.js deployment
- Cloudflare-managed custom domain and HTTPS
- Vitest, PostgreSQL integration tests, and Playwright security journeys

Supabase is the hosted development and production database. Automated database tests use an isolated temporary PostgreSQL container so test data cannot modify the hosted environment.

## Deliberate version-one exclusions

- Anonymous or public sharing links
- Folder permission inheritance
- Group-based grants
- Collaborative document editing
- Autonomous AI permission changes
- Mobile applications
- Claims of preventing screenshots or recovering already-downloaded copies

These exclusions keep the authorization model small enough to reason about and test thoroughly within the challenge timeline.

## Repository evidence

- [`THREATS.md`](THREATS.md) records anticipated attacks, controls, tests, and accepted risks.
- [`PROMPTS.md`](PROMPTS.md) records how AI was used, what it got wrong, and the commits that corrected it.
- [`docs/DATABASE.md`](docs/DATABASE.md) explains the Prisma/PostgreSQL model, invariants, migration workflow, and verification evidence.
- [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) explains credential, session, role, disabled-account, seed, and test decisions.
- [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md) defines the deny-by-default per-document action matrix and immediate-revocation contract.
- [`docs/API_AUTHORIZATION.md`](docs/API_AUTHORIZATION.md) documents the authenticated document metadata endpoints and their security behavior.
- [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) explains exact-email recipient lookup, owner-only sharing, history-preserving permission changes, and revocation.
- [`docs/AUDIT.md`](docs/AUDIT.md) explains event coverage, HMAC chaining, transactional writes, activity authorization, verification, and the external-checkpoint boundary.
- [`docs/STORAGE.md`](docs/STORAGE.md) defines the private R2 boundary, key strategy, least-privilege configuration, and current verification limits.
- [`docs/ORGANIZATION_SEARCH.md`](docs/ORGANIZATION_SEARCH.md) documents owner-scoped categories, authorization-composed search filters, and enumeration controls.
- [`docs/INTERFACE.md`](docs/INTERFACE.md) explains the member vault, administrator control room, browser request model, and UI verification boundary.
- [`docs/SECURITY_HARDENING.md`](docs/SECURITY_HARDENING.md) explains request limits, browser defenses, adversarial journeys, CI enforcement, and remaining deployment checks.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) defines the Vercel configuration, Cloudflare cutover, rollback, and production smoke test.

## Demo identities

The release includes three repeatable demo identities: administrator, document
owner, and viewer. Their email addresses and passwords are supplied through the
ignored local environment variables `DEMO_ADMIN_*`, `DEMO_OWNER_*`, and
`DEMO_VIEWER_*`; real passwords are never committed. Run `npm run db:seed:demo`
once from a trusted environment to create/enable them. The seed never overwrites
an existing password.

For judging, provide the three credentials privately alongside the live URL.
Public registration always creates an ordinary member and cannot request the
administrator role.

## Local development

Use Node.js 20.9 or newer. Copy `.env.example` to an ignored `.env`, replace
its placeholders, and apply the database migration before using authentication.

```bash
npm install
npm run db:migrate:deploy
npm run db:seed:demo
npm run dev
```

Open `http://localhost:3000`. The unauthenticated health check is available at
`GET /api/health` and intentionally returns only service status. `/vault` and
`/admin` require a current PostgreSQL-backed session; `/admin` additionally
requires the database `ADMIN` role.

Run the complete local quality gate before committing:

```bash
npm run check
```

This executes linting, strict TypeScript validation, unit tests, and the
production build. It now validates the Prisma schema and regenerates the typed
database client as part of the build. Use `npm audit` separately because it
requires registry access.

After applying migrations and seeding the demo identities, run the adversarial
Chromium journey with `npm run test:e2e`. `npm run test:security` combines the
application quality gate and that browser suite. CI also installs from the
lockfile and rejects high-severity dependency audit findings.

## Development rule

No phase is considered complete until its targeted checks pass, its security implications are reflected in `THREATS.md`, and its work is committed with a descriptive conventional commit.

