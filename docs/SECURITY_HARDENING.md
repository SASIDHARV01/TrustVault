# Phase 9 Security Hardening

Last verified: 2026-10-23

## Security boundaries added

Phase 9 turns the existing authorization rules into repeatable attack checks. It
does not replace endpoint authorization: every protected handler still resolves
the current database session and document permission before returning data.

### Shared application rate limiting

High-cost document search/mutation/upload/content, recipient lookup, activity,
audit verification, and checkpoint routes use named fixed-window policies. The
counter is an atomic PostgreSQL upsert, so limits are shared across processes and
survive application restarts. Only a SHA-256 fingerprint of policy plus client
address is stored. A refusal returns `429`, a generic JSON error, `Retry-After`,
an opaque request ID, and remaining/reset headers without exposing identity or
document data.

Authentication keeps Better Auth's dedicated login/registration limiter. The
application limits are defense in depth and never decide authorization.

### Browser policy

Dynamic login, registration, vault, and administrator pages receive a fresh
request nonce. Their Content Security Policy uses `strict-dynamic`, blocks
objects, frames, workers and cross-origin forms, and does not permit
`unsafe-inline`. Protected workspace pages also return `private, no-store`.
Static/public responses retain the compatible baseline policy configured by
Next.js. Production responses add HSTS, while all environments send MIME,
framing, opener, referrer, permissions, DNS-prefetch, and cross-domain-policy
defenses.

User-controlled names remain React text. Document bytes are served through the
authorized download boundary with safe content headers; active document types
are not embedded as executable HTML.

### Resource boundaries

- uploads accept only the existing PDF/PNG/JPEG allowlist up to 10 MiB;
- list endpoints keep bounded pagination and allowlisted sort/filter fields;
- JSON bodies retain their existing size limits;
- every R2 provider operation is aborted after 15 seconds; and
- expensive routes have explicit shared request budgets.

These controls protect the hackathon instance but do not replace provider quota
and latency alerts during deployment.

## Adversarial browser journey

`e2e/security-boundaries.spec.ts` drives three real sessions (owner, viewer, and
administrator) in Chromium. It proves:

1. an unrelated viewer cannot read, change, delete, or inspect grants for an
   owner's document;
2. an evil cross-site `Origin` cannot perform an authenticated mutation;
3. READ permits discovery but not mutation, and revocation blocks the next
   request;
4. administrator metadata visibility does not grant edit/delete powers;
5. an HTML event-handler payload is displayed literally and cannot create an
   element or execute;
6. protected pages use a nonce policy and no-store caching;
7. anonymous workspace navigation reaches sign-in;
8. denied decisions appear in administrator audit evidence and the chain still
   verifies; and
9. repeated audit verification reaches a controlled `429` response.

The PostgreSQL integration suite separately proves the limiter's atomic
concurrency behavior. Storage integration tests use the deterministic in-memory
adapter; they do not claim that placeholder CI credentials verify live R2.

## Running the gate

Apply all committed migrations and seed the demo identities, then run:

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

GitHub Actions repeats the lockfile install, high-severity dependency audit,
migrations, seed, application checks, production build, and Chromium journey
against PostgreSQL 15. Failure artifacts retain traces, screenshots, and video.

## Remaining deployment evidence

Phase 9 is complete when these checks pass locally and in CI. Production
readiness still requires Phase 10 to configure Supabase, a real private R2
bucket/token and checkpoint lock, Vercel secrets and function health, Cloudflare
DNS/TLS, backup/restore, secret rotation, and a live post-deploy smoke test.
