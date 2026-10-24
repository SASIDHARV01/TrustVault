import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getRuntimeDatabaseUrl } from "@/lib/server/database-url";

const globalDatabase = globalThis as unknown as {
  trustVaultPrisma?: PrismaClient;
};

export const DATABASE_TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 30_000,
} as const;

export const SERIALIZABLE_MAX_ATTEMPTS = 16;
const SERIALIZABLE_RETRY_BASE_MS = 4;
const SERIALIZABLE_RETRY_CAP_MS = 250;

function createDatabaseClient() {
  const adapter = new PrismaPg({
    connectionString: getRuntimeDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return new PrismaClient({
    adapter,
    transactionOptions: DATABASE_TRANSACTION_OPTIONS,
  });
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

function isSerializableConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }

  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error.cause as { kind?: unknown; originalCode?: unknown } | null)
      : null;
  return (
    cause?.kind === "TransactionWriteConflict" || cause?.originalCode === "40001"
  );
}

function serializableRetryDelayMs(attempt: number) {
  const ceiling = Math.min(
    SERIALIZABLE_RETRY_BASE_MS * 2 ** attempt,
    SERIALIZABLE_RETRY_CAP_MS,
  );

  // Jitter prevents concurrent requests from repeatedly colliding in lockstep.
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

export async function runSerializableTransaction<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (
        !isSerializableConflict(error) ||
        attempt === SERIALIZABLE_MAX_ATTEMPTS - 1
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, serializableRetryDelayMs(attempt)),
      );
    }
  }

  throw new Error("Serializable transaction retry loop exhausted unexpectedly.");
}
