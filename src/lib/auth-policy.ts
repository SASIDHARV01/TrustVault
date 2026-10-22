export const DEFAULT_AUTHENTICATED_PATH = "/vault";

export function getSafeCallbackPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  try {
    const url = new URL(value, "https://trustvault.local");

    if (url.origin !== "https://trustvault.local") {
      return DEFAULT_AUTHENTICATED_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
}

export function getLoginPath(callbackPath: string) {
  const safePath = getSafeCallbackPath(callbackPath);
  return `/login?next=${encodeURIComponent(safePath)}`;
}

export function isAdministrator(role: unknown): role is "ADMIN" {
  return role === "ADMIN";
}

export function isAccountActive(disabledAt: unknown) {
  return disabledAt === null || disabledAt === undefined;
}
