export const DOCUMENT_ACTIONS = [
  "DISCOVER",
  "VIEW_METADATA",
  "PREVIEW",
  "DOWNLOAD",
  "UPDATE_METADATA",
  "CREATE_VERSION",
  "DELETE",
  "RESTORE",
  "MANAGE_GRANTS",
  "VIEW_ACTIVITY",
  "ADMIN_OVERRIDE_READ",
] as const;

export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];
export type AuthorizationSystemRole = "MEMBER" | "ADMIN";
export type AuthorizationAccessLevel = "READ" | "EDIT";
export type AuthorizationDocumentState = "ACTIVE" | "DELETED";

export type DocumentAuthorizationReason =
  | "ALLOW_OWNER"
  | "ALLOW_READ_GRANT"
  | "ALLOW_EDIT_GRANT"
  | "ALLOW_ADMIN_METADATA"
  | "ALLOW_ADMIN_ACTIVITY"
  | "ALLOW_ADMIN_OVERRIDE"
  | "DENY_DOCUMENT_ACTIVE"
  | "DENY_DOCUMENT_DELETED"
  | "DENY_DOCUMENT_NOT_FOUND"
  | "DENY_OWNER_REQUIRED"
  | "DENY_ADMIN_REQUIRED"
  | "DENY_ADMIN_OVERRIDE_REQUIRED"
  | "DENY_OVERRIDE_REASON_REQUIRED"
  | "DENY_NO_ACTIVE_GRANT"
  | "DENY_INSUFFICIENT_GRANT";

export type DocumentAuthorizationDecision =
  | { allowed: true; reason: Extract<DocumentAuthorizationReason, `ALLOW_${string}`> }
  | { allowed: false; reason: Extract<DocumentAuthorizationReason, `DENY_${string}`> };

export type DocumentAuthorizationContext = {
  actorId: string;
  systemRole: AuthorizationSystemRole;
  documentOwnerId: string;
  documentState: AuthorizationDocumentState;
  activeGrant: AuthorizationAccessLevel | null;
  adminOverrideReason?: string | null;
};

const readActions = new Set<DocumentAction>([
  "DISCOVER",
  "VIEW_METADATA",
  "PREVIEW",
  "DOWNLOAD",
]);

const editActions = new Set<DocumentAction>([
  ...readActions,
  "UPDATE_METADATA",
  "CREATE_VERSION",
]);

const ownerActions = new Set<DocumentAction>([
  ...editActions,
  "DELETE",
  "MANAGE_GRANTS",
  "VIEW_ACTIVITY",
]);

export function isValidAdminOverrideReason(reason: string | null | undefined) {
  const length = reason?.trim().length ?? 0;
  return length >= 10 && length <= 500;
}

function allow(reason: Extract<DocumentAuthorizationReason, `ALLOW_${string}`>) {
  return { allowed: true, reason } as const;
}

function deny(reason: Extract<DocumentAuthorizationReason, `DENY_${string}`>) {
  return { allowed: false, reason } as const;
}

export function decideDocumentAuthorization(
  action: DocumentAction,
  context: DocumentAuthorizationContext,
): DocumentAuthorizationDecision {
  const isOwner = context.actorId === context.documentOwnerId;
  const isAdmin = context.systemRole === "ADMIN";

  if (context.documentState === "DELETED") {
    if (action === "RESTORE") {
      return isOwner ? allow("ALLOW_OWNER") : deny("DENY_OWNER_REQUIRED");
    }

    if (action === "VIEW_METADATA") {
      if (isOwner) return allow("ALLOW_OWNER");
      if (isAdmin) return allow("ALLOW_ADMIN_METADATA");
    }

    if (action === "VIEW_ACTIVITY") {
      if (isOwner) return allow("ALLOW_OWNER");
      if (isAdmin) return allow("ALLOW_ADMIN_ACTIVITY");
    }

    return deny("DENY_DOCUMENT_DELETED");
  }

  if (action === "RESTORE") {
    return deny("DENY_DOCUMENT_ACTIVE");
  }

  if (action === "ADMIN_OVERRIDE_READ") {
    if (!isAdmin) return deny("DENY_ADMIN_REQUIRED");
    if (!isValidAdminOverrideReason(context.adminOverrideReason)) {
      return deny("DENY_OVERRIDE_REASON_REQUIRED");
    }

    return allow("ALLOW_ADMIN_OVERRIDE");
  }

  if (isOwner && ownerActions.has(action)) {
    return allow("ALLOW_OWNER");
  }

  if (isAdmin && (action === "DISCOVER" || action === "VIEW_METADATA")) {
    return allow("ALLOW_ADMIN_METADATA");
  }

  if (isAdmin && action === "VIEW_ACTIVITY") {
    return allow("ALLOW_ADMIN_ACTIVITY");
  }

  if (context.activeGrant === "EDIT" && editActions.has(action)) {
    return allow("ALLOW_EDIT_GRANT");
  }

  if (context.activeGrant === "READ" && readActions.has(action)) {
    return allow("ALLOW_READ_GRANT");
  }

  if (action === "DELETE" || action === "MANAGE_GRANTS") {
    return deny("DENY_OWNER_REQUIRED");
  }

  if (
    context.activeGrant === "READ" &&
    (action === "UPDATE_METADATA" || action === "CREATE_VERSION")
  ) {
    return deny("DENY_INSUFFICIENT_GRANT");
  }

  if (isAdmin && (action === "PREVIEW" || action === "DOWNLOAD")) {
    return deny("DENY_ADMIN_OVERRIDE_REQUIRED");
  }

  return deny("DENY_NO_ACTIVE_GRANT");
}
