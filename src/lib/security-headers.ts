export function protectedContentSecurityPolicy(
  nonce: string,
  development = process.env.NODE_ENV === "development",
) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
