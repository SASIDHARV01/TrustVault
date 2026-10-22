import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";

import { PrismaClient, SystemRole } from "../src/generated/prisma/client";
import { createTrustVaultAuth } from "../src/lib/auth-config";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_ADMIN_EMAIL: z.string().email(),
  DEMO_ADMIN_PASSWORD: z.string().min(12).max(128),
  DEMO_OWNER_EMAIL: z.string().email(),
  DEMO_OWNER_PASSWORD: z.string().min(12).max(128),
  DEMO_VIEWER_EMAIL: z.string().email(),
  DEMO_VIEWER_PASSWORD: z.string().min(12).max(128),
});

const environment = environmentSchema.parse(process.env);

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    max: 2,
  }),
});

const seedAuth = createTrustVaultAuth({
  database: prisma,
  baseURL: environment.APP_URL,
  secret: environment.BETTER_AUTH_SECRET,
  secureCookies: false,
  rateLimitEnabled: false,
});

const demoUsers = [
  {
    name: "TrustVault Administrator",
    email: environment.DEMO_ADMIN_EMAIL,
    password: environment.DEMO_ADMIN_PASSWORD,
    role: SystemRole.ADMIN,
  },
  {
    name: "Document Owner",
    email: environment.DEMO_OWNER_EMAIL,
    password: environment.DEMO_OWNER_PASSWORD,
    role: SystemRole.MEMBER,
  },
  {
    name: "Document Viewer",
    email: environment.DEMO_VIEWER_EMAIL,
    password: environment.DEMO_VIEWER_PASSWORD,
    role: SystemRole.MEMBER,
  },
] as const;

async function seedDemoUsers() {
  for (const demoUser of demoUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: demoUser.email.toLowerCase() },
      select: { id: true },
    });

    let userId = existing?.id;

    if (!userId) {
      const result = await seedAuth.api.signUpEmail({
        body: {
          name: demoUser.name,
          email: demoUser.email,
          password: demoUser.password,
        },
      });
      userId = result.user.id;
      console.info(`Created ${demoUser.email}`);
    } else {
      console.info(`Kept existing ${demoUser.email}; password was not overwritten`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { role: demoUser.role, disabledAt: null },
    });

    // Seeding proves the supported password lifecycle but should not leave an
    // authenticated browser session behind.
    await prisma.session.deleteMany({ where: { userId } });
  }
}

try {
  await seedDemoUsers();
  console.info("Demo identities are ready.");
} finally {
  await prisma.$disconnect();
}
