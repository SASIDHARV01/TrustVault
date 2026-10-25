# TrustVault Authentication Architecture

Last verified: 2026-10-22

## What Phase 3 implements

TrustVault uses Better Auth 1.7.12 with email/password credentials, Prisma, and
PostgreSQL-backed sessions. It now provides:

- public registration and sign-in pages;
- slow password hashing through Better Auth's supported lifecycle;
- HTTP-only, same-site session cookies that become secure-only in production;
- seven-day database sessions with daily rotation;
- a protected member workspace at `/vault`;
- a server-authorized administrator area at `/admin`;
- an authenticated, non-cacheable identity endpoint at `GET /api/session`;
- immediate denial for accounts with a non-null `disabledAt` value;
- repeatable demo identities created without inserting raw passwords.

Email verification, password reset email delivery, multi-factor authentication,
user-management screens, and authentication audit-chain events are intentionally
deferred to later phases. The current demo release must not be described as
enterprise identity management.

## Request workflow

1. `src/proxy.ts` checks whether a TrustVault session cookie exists before a
   browser enters `/vault` or `/admin`. This is only a fast navigation check.
2. The destination server component calls `requireSession()` or
   `requireAdministrator()`.
3. Better Auth loads the session and user from PostgreSQL. Cookie session caching
   is disabled, so database role and account-disable changes take effect on the
   next protected request.
4. The session helper rejects a missing, expired, or disabled session. The admin
   helper additionally requires the database `ADMIN` role.
5. Only after those checks does the protected page render.

The Proxy is not the security boundary. A forged cookie may pass its optimistic
existence check, but the protected server component will fail the database
validation and redirect to sign-in.

## Security decisions

### Role mass-assignment protection

Registration always creates `MEMBER`. The Better Auth `role` field uses
`input: false`, so an extra browser field such as `role: "ADMIN"` is ignored.
Administrator promotion is a trusted database/administration operation, never a
registration option.

System role is also separate from document permissions. `ADMIN` permits entry to
the administration area but does not silently grant document edit, delete, or
sharing rights. Future administrator content viewing must use the explicit,
reason-bearing `ADMIN_OVERRIDE_READ` workflow.

### Session freshness and disabled accounts

Sessions are stored in PostgreSQL and the session cookie contains only the
unguessable session token. TrustVault does not cache the user/session payload in
the cookie. A disabled account is blocked when a new session is created and when
an existing session is used by any protected TrustVault route.

### Origin, cookie, and redirect protection

- Better Auth origin checks remain explicitly enabled, even in automated tests.
- Only `APP_URL` is trusted for state-changing authentication requests.
- Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/`.
- Post-login callback paths accept only same-site relative URLs. Absolute and
  protocol-relative values fall back to `/vault`, preventing open redirects.
- Login and registration forms use POST as their no-JavaScript fallback so a
  hydration failure cannot place credentials in a URL.

### Authentication throttling

Authentication rate limiting is enabled in every environment. Sign-in permits
10 attempts per minute per Better Auth key and registration permits 5. Better
Auth uses the same atomic PostgreSQL counter table as the protected application
routes, so limits remain shared across independently scaled Vercel functions.

## Environment variables

Required at runtime:

- `DATABASE_URL`: pooled PostgreSQL runtime connection, normally the Supabase
  transaction pooler on port `6543` for Vercel;
- `APP_URL`: exact public application origin, for example
  `https://vault.example.com`;
- `BETTER_AUTH_SECRET`: at least 32 random characters, generated independently
  from the audit HMAC key.

The production build can complete without a live database or runtime secret.
Build-only placeholders are accepted only while Next.js reports its production
build phase; real runtime authentication still fails closed when configuration
is absent.

## Demo identities

Set all `DEMO_*` variables from `.env.example`, apply migrations, then run:

```bash
npm run db:seed:demo
```

The command creates one administrator and two ordinary members through Better
Auth, promotes only the configured administrator through trusted server code,
and deletes seed-created sessions. Rerunning it keeps existing password hashes
instead of silently resetting credentials; it refreshes the intended role and
reenables the three demo accounts.

Never use the example passwords in production or commit real credentials.

## Verification

The normal unit suite runs without a database. The PostgreSQL integration test
is opt-in so it cannot touch Supabase accidentally:

```bash
npm test
TEST_DATABASE_URL=postgresql://... npm test -- tests/auth.integration.test.ts
```

The integration test proves that:

- a submitted `ADMIN` role still creates a `MEMBER`;
- the credential account stores a hash, not the submitted password;
- production cookies include secure attributes;
- the database session can be resolved from the cookie;
- an untrusted origin is rejected;
- a disabled user cannot create a new session.

Browser and live local checks additionally proved anonymous `/vault` and
`/api/session` denial, member rejection from `/admin`, trusted administrator
access, immediate existing-session denial after account disablement, sign-out,
and responsive login/workspace layouts.
