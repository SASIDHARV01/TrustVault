export type UserSummary = { id: string; name: string; email: string };

export type DocumentAccess = "OWNER" | "READ" | "EDIT" | "ADMIN_METADATA";

export type VaultDocument = {
  id: string;
  name: string;
  description: string | null;
  state: "ACTIVE" | "DELETED";
  access: DocumentAccess;
  owner: UserSummary;
  category: { id: string; name: string } | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  activeDocumentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  sizeBytes: number;
  sha256: string;
  storageState: "READY";
  createdAt: string;
  createdBy: UserSummary;
};

export type DocumentGrant = {
  id: string;
  documentId: string;
  accessLevel: "READ" | "EDIT";
  status: "ACTIVE" | "REVOKED";
  recipient: UserSummary;
  grantedBy: { id: string; name: string };
  revokedBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  usage: {
    totalUses: number;
    metadataViews: number;
    versionHistoryViews: number;
    previews: number;
    downloads: number;
    metadataEdits: number;
    versionUploads: number;
    firstUsedAt: string | null;
    lastUsedAt: string | null;
    deniedAfterRevocationCount: number;
    latestDeniedAfterRevocationAt: string | null;
  };
};

export type AccessIntelligenceGrant = DocumentGrant & {
  document: {
    id: string;
    name: string;
    state: "ACTIVE" | "DELETED";
    owner: UserSummary;
  };
  grantedBy: UserSummary;
  revokedBy: UserSummary | null;
};

export type AuditEvent = {
  eventId: string;
  action: string;
  outcome: "ALLOWED" | "DENIED" | "FAILED";
  resource: string;
  targetId: string;
  reason: string;
  requestId: string;
  metadata: unknown;
  occurredAt: string;
  actor: UserSummary | null;
  document: { id: string; name: string } | null;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type AuditCheckpoint = {
  id: string;
  throughEventId: string;
  chainHash: string;
  createdAt: string;
};

type ErrorEnvelope = { error?: { code?: string; message?: string } };

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

async function errorFromResponse(response: Response) {
  let payload: ErrorEnvelope = {};
  try {
    payload = (await response.json()) as ErrorEnvelope;
  } catch {
    // A safe generic message is used for non-JSON upstream failures.
  }
  return new ClientApiError(
    payload.error?.message ?? "The request could not be completed.",
    payload.error?.code ?? "REQUEST_FAILED",
    response.status,
  );
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as T;
}

export async function fetchPrivateContent(
  path: string,
  headers?: HeadersInit,
) {
  const response = await fetch(path, {
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await errorFromResponse(response);
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
    mimeType: response.headers.get("Content-Type") ?? "application/octet-stream",
  };
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] ?? null;
}

export function queryString(values: Record<string, string | number | undefined>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

export function readableError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
