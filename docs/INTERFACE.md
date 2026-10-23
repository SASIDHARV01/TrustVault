# TrustVault Vault and Administration Interface

Last verified: 2026-10-23

## Phase 8 scope

Phase 8 replaces the protected placeholder pages with responsive, API-driven
workspaces. The interface is deliberately a client of the existing security
boundary: it never treats hidden or disabled controls as authorization. Every
read and mutation still reaches the authenticated route handlers and their
central authorization services.

## Member vault

The `/vault` workspace now supports:

- authorization-scoped name, owner, category, and creation-date search plus
  sorting, pagination, active documents, and owner-only trash discovery;
- owner category creation, rename, and deletion;
- metadata creation followed by the first immutable file upload;
- metadata editing for owners and active EDIT recipients;
- owner-only category assignment, deletion, restoration, and sharing controls;
- PDF, PNG, and JPEG version upload, version history, verified preview, and
  verified download;
- READ or EDIT access grants by exact existing-account email, access-level
  changes, and immediate revocation; and
- owner-visible per-document audit activity.

The create-and-upload flow intentionally reports partial failure. If metadata
creation succeeds but private object upload fails, the record remains visible
so its owner can retry a version upload rather than losing track of it.

## Administrator control room

The `/admin` workspace now provides:

- active/deleted document metadata discovery across owners;
- system-wide audit event filters and pagination;
- full stored-chain verification;
- protected R2 audit checkpoint creation and checkpoint history; and
- document version preview/download through an explicit 10–500 character
  override reason.

Administrator controls intentionally omit metadata edit, delete, restore,
category, and sharing actions. An override reason is sent only to the dedicated
content route; the server evaluates it and records the decision. The interface
does not expose object keys, provider URLs, hashes for document content, policy
denial details, or session secrets.

## Browser request model

Interactive components use same-origin, no-store requests with the existing
database-backed session cookie. JSON mutations use the route schemas already
defined for documents, categories, and grants. File bodies remain multipart.
Binary content is fetched only after authorization and exposed through a short-
lived browser object URL that is revoked after use.

Server Components continue to perform the initial session or administrator
gate before the interactive workspace is rendered. Only minimal display-safe
session data is passed into a Client Component.

## Verification evidence

The implementation passed strict TypeScript, zero-warning ESLint, the Vitest
suite, and the Next.js production build. These checks verify compilation and
the API/helper contracts; browser role journeys and live Supabase/R2 behavior
remain Phase 9 and deployment verification work.
