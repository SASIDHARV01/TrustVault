import type { Metadata } from "next";

import { CyberIntro } from "@/components/cyber/cyber-intro";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TrustVault — Secure document sharing",
    template: "%s | TrustVault",
  },
  description:
    "Share confidential documents with explicit access, immediate revocation, and a verifiable audit trail.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <CyberIntro />
        {children}
      </body>
    </html>
  );
}
