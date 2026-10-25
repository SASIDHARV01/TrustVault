import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import { grantUsageById } from "@/lib/server/permission-service";

describe("grant access intelligence", () => {
  it("separates usage and post-revocation denials across grant lifecycles", async () => {
    const events = [
      {
        actorId: "viewer-1",
        documentId: "document-1",
        action: "DOCUMENT_METADATA_READ",
        outcome: "ALLOWED",
        metadata: {},
        occurredAt: new Date("2026-10-25T00:10:00.000Z"),
      },
      {
        actorId: "viewer-1",
        documentId: "document-1",
        action: "DOCUMENT_READ",
        outcome: "ALLOWED",
        metadata: { disposition: "inline" },
        occurredAt: new Date("2026-10-25T00:20:00.000Z"),
      },
      {
        actorId: "viewer-1",
        documentId: "document-1",
        action: "DOCUMENT_DOWNLOAD",
        outcome: "DENIED",
        metadata: { disposition: "attachment" },
        occurredAt: new Date("2026-10-25T01:10:00.000Z"),
      },
      {
        actorId: "viewer-1",
        documentId: "document-1",
        action: "DOCUMENT_DOWNLOAD",
        outcome: "ALLOWED",
        metadata: { disposition: "attachment" },
        occurredAt: new Date("2026-10-25T02:10:00.000Z"),
      },
    ];
    const database = {
      auditEvent: { findMany: vi.fn().mockResolvedValue(events) },
    } as unknown as PrismaClient;
    const grants = [
      {
        id: "grant-read",
        documentId: "document-1",
        recipient: { id: "viewer-1" },
        createdAt: new Date("2026-10-25T00:00:00.000Z"),
        revokedAt: new Date("2026-10-25T01:00:00.000Z"),
      },
      {
        id: "grant-edit",
        documentId: "document-1",
        recipient: { id: "viewer-1" },
        createdAt: new Date("2026-10-25T02:00:00.000Z"),
        revokedAt: null,
      },
    ];

    const summaries = await grantUsageById(database, grants);

    expect(summaries.get("grant-read")).toMatchObject({
      totalUses: 2,
      metadataViews: 1,
      previews: 1,
      downloads: 0,
      deniedAfterRevocationCount: 1,
      firstUsedAt: "2026-10-25T00:10:00.000Z",
      lastUsedAt: "2026-10-25T00:20:00.000Z",
      latestDeniedAfterRevocationAt: "2026-10-25T01:10:00.000Z",
    });
    expect(summaries.get("grant-edit")).toMatchObject({
      totalUses: 1,
      downloads: 1,
      deniedAfterRevocationCount: 0,
      firstUsedAt: "2026-10-25T02:10:00.000Z",
    });
  });
});
