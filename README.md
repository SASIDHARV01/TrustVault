# TrustVault

TrustVault is a security-first document-sharing platform where access is granted to named people per document, revoked access stops working on the next request, and both successful and rejected actions are preserved in a tamper-evident audit trail.

## Project status

TrustVault is being built incrementally for the Snovyasis document-security challenge. Each phase is validated and committed before the next phase begins. Production deployment to Render and the Cloudflare domain is intentionally scheduled for the final implementation phase.

Phases 0–5 currently provide the security contract, public web foundation,
validated PostgreSQL data model, Better Auth credentials and sessions, protected
member/admin routes, repeatable demo identities, centralized per-document
authorization, authorized document metadata APIs, and owner-controlled named-user
READ/EDIT sharing. Phase 5 adds transaction-coupled allowed/denied audit events,
an HMAC-linked append-only chain, owner/admin activity APIs, and administrator
integrity verification. Document byte storage, independent R2 chain-head
checkpoints, activity screens, and deployment are not implemented yet.

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

An administrator can manage users, review system-wide document metadata, inspect audit activity, verify audit integrity, and use an explicit privileged document-viewing flow. Privileged viewing requires a reason and creates a high-visibility `ADMIN_OVERRIDE_READ` event. It does not grant edit, delete, ownership, or permission-management rights.

### Document owner

An owner can upload documents, manage metadata and categories, create versions, grant or revoke named-user access, delete or recover owned documents, and inspect activity for owned documents.

### Viewer

A viewer can access only documents covered by a current named-user grant:

- `READ`: discover metadata, preview, and download.
- `EDIT`: all `READ` actions plus creating a new immutable version.

`EDIT` never permits deletion, recovery, ownership transfer, or permission management.

## Planned architecture

- Full-stack Next.js with TypeScript and the Node.js runtime
- Better Auth with PostgreSQL-backed sessions
- Supabase-hosted PostgreSQL with Prisma migrations
- Private Cloudflare R2 document storage
- Render Free Web Service for the final deployment
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
- Storage API documentation, seed credentials, clean-clone setup, deployment instructions, and the demo guide will be added in their corresponding phases.

## Local development

Use Node.js 20.9 or newer. Copy `.env.example` to an ignored `.env.local`, replace
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

## Development rule

No phase is considered complete until its targeted checks pass, its security implications are reflected in `THREATS.md`, and its work is committed with a descriptive conventional commit.

