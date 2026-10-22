import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import { createTrustVaultAuth } from "../src/lib/auth-config";
import { isAccountActive } from "../src/lib/auth-policy";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const testEmail = `auth-integration-${process.pid}@trustvault.local`;
const crossSiteEmail = `cross-site-${testEmail}`;
const testPassword = "correct-horse-battery-staple";

describeWithDatabase("Better Auth PostgreSQL integration", () => {
  if (!databaseUrl) {
    return;
  }

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });
  const testAuth = createTrustVaultAuth({
    database,
    baseURL: "https://trustvault.test",
    secret: "integration-test-secret-with-32-characters",
    secureCookies: true,
    rateLimitEnabled: false,
  });

  beforeAll(async () => {
    await database.user.deleteMany({
      where: { email: { in: [testEmail, crossSiteEmail] } },
    });
  });

  afterAll(async () => {
    await database.user.deleteMany({
      where: { email: { in: [testEmail, crossSiteEmail] } },
    });
    await database.$disconnect();
  });

  it("ignores role mass assignment, hashes the password, and creates a secure session", async () => {
    const response = await testAuth.handler(
      new Request("https://trustvault.test/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://trustvault.test",
        },
        body: JSON.stringify({
          name: "Integration Member",
          email: testEmail,
          password: testPassword,
          role: "ADMIN",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const user = await database.user.findUniqueOrThrow({
      where: { email: testEmail },
      include: { accounts: true },
    });
    expect(user.role).toBe("MEMBER");
    expect(user.accounts[0]?.password).toBeTruthy();
    expect(user.accounts[0]?.password).not.toBe(testPassword);

    const cookie = setCookie.split(";")[0];
    const sessionResponse = await testAuth.handler(
      new Request("https://trustvault.test/api/auth/get-session", {
        headers: { cookie },
      }),
    );
    expect(sessionResponse.status).toBe(200);

    const session = (await sessionResponse.json()) as {
      user: { role: string; disabledAt?: string | null };
    };
    expect(session.user.role).toBe("MEMBER");
    expect(isAccountActive(session.user.disabledAt)).toBe(true);
  });

  it("rejects untrusted origins and disabled-account sign in", async () => {
    const untrustedResponse = await testAuth.handler(
      new Request("https://trustvault.test/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          name: "Cross Site",
          email: crossSiteEmail,
          password: testPassword,
        }),
      }),
    );
    expect(untrustedResponse.status).toBe(403);

    await database.user.update({
      where: { email: testEmail },
      data: { disabledAt: new Date() },
    });

    const signInResponse = await testAuth.handler(
      new Request("https://trustvault.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://trustvault.test",
        },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      }),
    );
    expect(signInResponse.status).toBe(403);
  });
});
