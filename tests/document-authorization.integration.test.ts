import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../src/generated/prisma/client";
import { authorizeDocument } from "../src/lib/server/document-authorization";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const suffix = `${process.pid}-${Date.now()}`;

describeWithDatabase("document authorization PostgreSQL integration", () => {
  if (!databaseUrl) return;

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });
  const users = {
    owner: `owner-${suffix}`,
    reader: `reader-${suffix}`,
    editor: `editor-${suffix}`,
    revoked: `revoked-${suffix}`,
    unrelated: `unrelated-${suffix}`,
    admin: `admin-${suffix}`,
  };
  const documentId = `document-${suffix}`;

  beforeAll(async () => {
    await database.user.createMany({
      data: Object.entries(users).map(([label, id]) => ({
        id,
        name: `Test ${label}`,
        email: `${id}@trustvault.local`,
        role: label === "admin" ? ("ADMIN" as const) : ("MEMBER" as const),
      })),
    });
    await database.document.create({
      data: {
        id: documentId,
        ownerId: users.owner,
        name: "Authorization Evidence.pdf",
      },
    });
    await database.documentGrant.createMany({
      data: [
        {
          id: `read-${suffix}`,
          documentId,
          recipientId: users.reader,
          accessLevel: "READ",
          grantedById: users.owner,
        },
        {
          id: `edit-${suffix}`,
          documentId,
          recipientId: users.editor,
          accessLevel: "EDIT",
          grantedById: users.owner,
        },
        {
          id: `revoked-${suffix}`,
          documentId,
          recipientId: users.revoked,
          accessLevel: "READ",
          grantedById: users.owner,
          revokedAt: new Date(),
          revokedById: users.owner,
        },
      ],
    });
  });

  afterAll(async () => {
    await database.documentGrant.deleteMany({ where: { documentId } });
    await database.document.deleteMany({ where: { id: documentId } });
    await database.user.deleteMany({
      where: { id: { in: Object.values(users) } },
    });
    await database.$disconnect();
  });

  async function decide(
    actorId: string,
    systemRole: "MEMBER" | "ADMIN",
    action: Parameters<typeof authorizeDocument>[0]["action"],
    adminOverrideReason?: string,
  ) {
    return authorizeDocument(
      {
        actorId,
        systemRole,
        documentId,
        action,
        adminOverrideReason,
      },
      database,
    );
  }

  it("enforces owner, reader, editor, unrelated, revoked, and administrator boundaries", async () => {
    await expect(decide(users.owner, "MEMBER", "DELETE")).resolves.toMatchObject({
      decision: { allowed: true, reason: "ALLOW_OWNER" },
    });
    await expect(decide(users.reader, "MEMBER", "PREVIEW")).resolves.toMatchObject({
      decision: { allowed: true, reason: "ALLOW_READ_GRANT" },
    });
    await expect(
      decide(users.reader, "MEMBER", "CREATE_VERSION"),
    ).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_INSUFFICIENT_GRANT" },
    });
    await expect(
      decide(users.editor, "MEMBER", "CREATE_VERSION"),
    ).resolves.toMatchObject({
      decision: { allowed: true, reason: "ALLOW_EDIT_GRANT" },
    });
    await expect(
      decide(users.editor, "MEMBER", "MANAGE_GRANTS"),
    ).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_OWNER_REQUIRED" },
    });
    await expect(
      decide(users.unrelated, "MEMBER", "VIEW_METADATA"),
    ).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_NO_ACTIVE_GRANT" },
    });
    await expect(
      decide(users.revoked, "MEMBER", "VIEW_METADATA"),
    ).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_NO_ACTIVE_GRANT" },
    });
    await expect(
      decide(users.admin, "ADMIN", "VIEW_METADATA"),
    ).resolves.toMatchObject({
      decision: { allowed: true, reason: "ALLOW_ADMIN_METADATA" },
    });
    await expect(decide(users.admin, "ADMIN", "DOWNLOAD")).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_ADMIN_OVERRIDE_REQUIRED" },
    });
    await expect(
      decide(
        users.admin,
        "ADMIN",
        "ADMIN_OVERRIDE_READ",
        "Investigating a reported disclosure incident",
      ),
    ).resolves.toMatchObject({
      decision: { allowed: true, reason: "ALLOW_ADMIN_OVERRIDE" },
    });
  });

  it("makes revocation effective on the next authorization query", async () => {
    await expect(decide(users.reader, "MEMBER", "DOWNLOAD")).resolves.toMatchObject({
      decision: { allowed: true },
    });

    await database.documentGrant.update({
      where: { id: `read-${suffix}` },
      data: { revokedAt: new Date(), revokedById: users.owner },
    });

    await expect(decide(users.reader, "MEMBER", "DOWNLOAD")).resolves.toMatchObject({
      decision: { allowed: false, reason: "DENY_NO_ACTIVE_GRANT" },
    });
  });
});
