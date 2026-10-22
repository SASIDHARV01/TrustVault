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

// Libraries such as Better Auth accept a Prisma-shaped object during module
// initialization. This proxy preserves that shape without reading DATABASE_URL
// until the first real database operation runs.
export function getLazyDatabase() {
  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      // The auth adapter optionally reads this during startup for a schema
      // warning. Returning undefined skips that nonessential eager inspection.
      if (property === "_runtimeDataModel") {
        return undefined;
      }

      const database = getDatabase();
      const value = Reflect.get(database, property);

      return typeof value === "function" ? value.bind(database) : value;
    },
  });
}
