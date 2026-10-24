import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  DATABASE_TRANSACTION_OPTIONS,
  SERIALIZABLE_MAX_ATTEMPTS,
  runSerializableTransaction,
} from "@/lib/server/database";

describe("database transaction configuration", () => {
  it("allows bounded time for a cold managed PostgreSQL connection", () => {
    expect(DATABASE_TRANSACTION_OPTIONS).toEqual({
      maxWait: 15_000,
      timeout: 30_000,
    });
  });
});

describe("runSerializableTransaction", () => {
  it("retries PostgreSQL write conflicts and preserves serializable isolation", async () => {
    const conflict = Object.assign(new Error("write conflict"), {
      cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
    });
    const execute = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce("ok");
    const database = { $transaction: execute } as unknown as PrismaClient;
    const operation = vi.fn().mockResolvedValue("ok");

    await expect(
      runSerializableTransaction(database, operation),
    ).resolves.toBe("ok");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, operation, {
      isolationLevel: "Serializable",
    });
    expect(execute).toHaveBeenNthCalledWith(2, operation, {
      isolationLevel: "Serializable",
    });
  });

  it("does not retry unrelated failures", async () => {
    const failure = new Error("database unavailable");
    const execute = vi.fn().mockRejectedValue(failure);
    const database = { $transaction: execute } as unknown as PrismaClient;

    await expect(
      runSerializableTransaction(database, vi.fn()),
    ).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("survives a burst longer than the former eight-attempt limit", async () => {
    vi.useFakeTimers();
    try {
      const conflict = Object.assign(new Error("write conflict"), {
        cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
      });
      let conflictsRemaining = 10;
      const execute = vi.fn().mockImplementation(() => {
        if (conflictsRemaining > 0) {
          conflictsRemaining -= 1;
          return Promise.reject(conflict);
        }
        return Promise.resolve("ok");
      });
      const database = { $transaction: execute } as unknown as PrismaClient;

      const result = runSerializableTransaction(database, vi.fn());
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe("ok");
      expect(execute).toHaveBeenCalledTimes(11);
      expect(SERIALIZABLE_MAX_ATTEMPTS).toBeGreaterThan(11);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying after the bounded maximum", async () => {
    vi.useFakeTimers();
    try {
      const conflict = Object.assign(new Error("write conflict"), {
        cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
      });
      const execute = vi.fn().mockRejectedValue(conflict);
      const database = { $transaction: execute } as unknown as PrismaClient;

      const rejection = expect(
        runSerializableTransaction(database, vi.fn()),
      ).rejects.toBe(conflict);
      await vi.runAllTimersAsync();

      await rejection;
      expect(execute).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS);
    } finally {
      vi.useRealTimers();
    }
  });
});
