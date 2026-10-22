import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getRuntimeDatabaseUrl } from "@/lib/server/database-url";

const globalDatabase = globalThis as unknown as {
  trustVaultPrisma?: PrismaClient;
};

function createDatabaseClient() {
  const adapter = new PrismaPg({
    connectionString: getRuntimeDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}

// Lazy creation keeps static builds independent from database availability.
// Development reuses one pool across Next.js hot reloads.
export function getDatabase() {
  if (!globalDatabase.trustVaultPrisma) {
    globalDatabase.trustVaultPrisma = createDatabaseClient();
  }

  return globalDatabase.trustVaultPrisma;
}
