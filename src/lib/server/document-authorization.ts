import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  decideDocumentAuthorization,
  type AuthorizationSystemRole,
  type DocumentAction,
  type DocumentAuthorizationDecision,
} from "@/lib/document-authorization";
import { getDatabase } from "@/lib/server/database";

type AuthorizationDatabase = Pick<PrismaClient, "document">;

export type AuthorizeDocumentInput = {
  actorId: string;
  systemRole: AuthorizationSystemRole;
  documentId: string;
  action: DocumentAction;
  adminOverrideReason?: string | null;
};

export type DocumentAuthorizationResult =
  | {
      document: null;
      decision: { allowed: false; reason: "DENY_DOCUMENT_NOT_FOUND" };
    }
  | {
      document: {
        id: string;
        ownerId: string;
        state: "ACTIVE" | "DELETED";
      };
      decision: DocumentAuthorizationDecision;
    };

export async function authorizeDocument(
  input: AuthorizeDocumentInput,
  database: AuthorizationDatabase = getDatabase(),
): Promise<DocumentAuthorizationResult> {
  // This query deliberately selects only the current actor's active grant.
  // Callers must not cache the result across requests or permission mutations.
  const document = await database.document.findUnique({
    where: { id: input.documentId },
    select: {
      id: true,
      ownerId: true,
      state: true,
      grants: {
        where: {
          recipientId: input.actorId,
          revokedAt: null,
        },
        select: { accessLevel: true },
        take: 1,
      },
    },
  });

  if (!document) {
    return {
      document: null,
      decision: { allowed: false, reason: "DENY_DOCUMENT_NOT_FOUND" },
    };
  }

  return {
    document: {
      id: document.id,
      ownerId: document.ownerId,
      state: document.state,
    },
    decision: decideDocumentAuthorization(input.action, {
      actorId: input.actorId,
      systemRole: input.systemRole,
      documentOwnerId: document.ownerId,
      documentState: document.state,
      activeGrant: document.grants[0]?.accessLevel ?? null,
      adminOverrideReason: input.adminOverrideReason,
    }),
  };
}
