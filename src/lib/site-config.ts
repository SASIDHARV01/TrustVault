export const siteConfig = {
  name: "TrustVault",
  description:
    "Secure document sharing with immediate revocation and a verifiable audit trail.",
  navigation: [
    { label: "Security", href: "#security" },
    { label: "How it works", href: "#workflow" },
    { label: "Architecture", href: "#architecture" },
  ],
  safeguards: [
    "Server-side authorization",
    "Immediate permission revocation",
    "Tamper-evident activity records",
  ],
} as const;
