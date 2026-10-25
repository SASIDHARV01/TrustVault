# TrustVault production deployment

Last verified: 2026-10-25

## Production topology

- Vercel hosts the full-stack Next.js application.
- Vercel serves static landing assets globally and runs Node.js functions in
  Sydney (`syd1`), close to the Supabase project in `ap-southeast-2`.
- Supabase PostgreSQL stores identities, sessions, authorization state, search
  metadata, request-limit counters, and audit evidence.
- Cloudflare R2 remains private storage for document bytes and audit
  checkpoints.
- Cloudflare manages DNS for `trust-vault.aquaries.dev`; Vercel issues and
  renews the application TLS certificate.

`vercel.json` enables Fluid Compute and pins the single Hobby function region.
Static assets remain globally distributed regardless of the function region.

## Release gate

Before promoting a commit:

```bash
npm ci
npm run check
```

Apply committed migrations from a controlled environment before deploying code
that depends on them:

```bash
npm run db:migrate:deploy
npm run db:migrate:status
```

Vercel builds must not seed users or mutate the schema. `npm run build` only
generates the Prisma client and builds Next.js.

## Vercel project

Import `SASIDHARV01/TrustVault` and use:

- production branch: `main`;
- framework preset: Next.js;
- root directory: repository root;
- install command: `npm ci`;
- build command: `npm run build`;
- output directory: Next.js default;
- Node.js: a supported release satisfying `package.json` (`>=20.9.0`).

Add the following variables to the Production environment only:

```text
APP_URL
BETTER_AUTH_SECRET
AUDIT_HMAC_KEY_VERSION
AUDIT_HMAC_KEYS
DATABASE_URL
DIRECT_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_JURISDICTION
```

Use the Supabase transaction pooler on port `6543` for `DATABASE_URL`. Use the
session pooler on port `5432` for `DIRECT_URL` because migrations require
session continuity. Copy both complete URLs from Supabase; do not change only a
port because connection usernames and endpoints may differ.

Do not add demo passwords to Vercel. Seeding is an intentional one-time
administrative action, never a deployment step. Do not expose production
secrets to preview deployments.

For the first deployment, set `APP_URL` to the exact Vercel production URL.
After the custom domain is verified, change it to:

```text
https://trust-vault.aquaries.dev
```

Redeploy after changing `APP_URL`. TrustVault intentionally rejects
state-changing requests from any other origin.

## Cloudflare DNS cutover

1. Add `trust-vault.aquaries.dev` to the Vercel project.
2. Copy the exact verification and CNAME records Vercel displays.
3. In Cloudflare DNS, replace the existing Render record with the Vercel CNAME.
4. Use **DNS only** until Vercel verifies the domain and issues TLS.
5. Verify `/`, `/api/health`, `/login`, and `/register` over HTTPS.
6. Update `APP_URL` to the custom origin and redeploy.
7. Complete the authenticated smoke test below before removing Render.

Keep the Render service available as a rollback target during the cutover. DNS
can be pointed back to its previous target if the Vercel smoke test fails.

## Production smoke test

Verify all of the following against the custom domain:

1. The cinematic intro replays on every landing-page reload and never blocks
   authentication or workspace routes.
2. Registration creates an ordinary member; administrator status cannot be
   self-selected.
3. Owner login, upload, preview, download, new-version upload, and logout work.
4. A READ grant appears only in the recipient's Shared Dimensions view.
5. READ cannot mutate; EDIT can add a version but cannot grant or delete.
6. Revocation blocks the recipient on the next request.
7. Administrator override requires a reason and creates visible audit evidence.
8. Audit verification succeeds and a checkpoint reaches private R2.
9. `/api/health` returns `200`, private/no-store responses remain uncached, and
   security headers remain present.

## Remaining operational controls

- Keep the R2 bucket private and restrict its token to the TrustVault bucket.
- Configure an indefinite bucket-lock rule for `audit-checkpoints/`.
- Confirm Supabase backup and restore procedures.
- Rotate deployment credentials after any accidental disclosure.
- Vercel Hobby reduces but cannot eliminate function cold starts. Static landing
  assets remain CDN-served; guaranteed warm functions require a paid plan.
