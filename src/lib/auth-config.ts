import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";

import type { PrismaClient } from "../generated/prisma/client";
import { createAuthRateLimitStorage } from "@/lib/server/auth-rate-limit";

export function createTrustVaultAuth({
  database,
  baseURL,
  secret,
  secureCookies,
  rateLimitEnabled = true,
}: {
  database: PrismaClient;
  baseURL?: string;
  secret?: string;
  secureCookies: boolean;
  rateLimitEnabled?: boolean;
}) {
  return betterAuth({
    appName: "TrustVault",
    baseURL,
    secret,
    database: prismaAdapter(database, {
      provider: "postgresql",
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: ["MEMBER", "ADMIN"],
          defaultValue: "MEMBER",
          input: false,
        },
        disabledAt: {
          type: "date",
          required: false,
          input: false,
          returned: true,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await database.user.findUnique({
              where: { id: session.userId },
              select: { disabledAt: true },
            });

            // During signup, Better Auth creates the user and session inside one
            // transaction. This separate guard query cannot see that uncommitted
            // user yet; the Session.userId foreign key still rejects nonexistent
            // users. An existing disabled user is always rejected.
            if (user?.disabledAt) {
              throw new APIError("FORBIDDEN", {
                message: "This account is not available.",
              });
            }

            return { data: session };
          },
        },
      },
    },
    rateLimit: {
      enabled: rateLimitEnabled,
      customStorage: createAuthRateLimitStorage(database),
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    trustedOrigins: baseURL ? [baseURL] : [],
    advanced: {
      cookiePrefix: "trustvault",
      useSecureCookies: secureCookies,
      disableOriginCheck: false,
    },
  });
}
