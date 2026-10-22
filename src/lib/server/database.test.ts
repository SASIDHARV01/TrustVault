import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import { runSerializableTransaction } from "@/lib/server/database";

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
});
