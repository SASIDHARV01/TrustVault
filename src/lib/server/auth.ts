import "server-only";

import { createTrustVaultAuth } from "@/lib/auth-config";
import { getLazyDatabase } from "@/lib/server/database";

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
const appUrl =
  process.env.APP_URL ?? (isProductionBuild ? "http://localhost:3000" : undefined);
const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  (isProductionBuild
    ? "build-only-placeholder-never-used-at-runtime"
    : undefined);

export const auth = createTrustVaultAuth({
  database: getLazyDatabase(),
  baseURL: appUrl,
  secret: authSecret,
  secureCookies: process.env.NODE_ENV === "production",
});

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;
