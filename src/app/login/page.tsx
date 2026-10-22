import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getSafeCallbackPath } from "@/lib/auth-policy";
import { getCurrentSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const callbackPath = getSafeCallbackPath((await searchParams).next);
  const session = await getCurrentSession();

  if (session) {
    redirect(callbackPath);
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to TrustVault"
      description="Use the account connected to your confidential workspace."
    >
      <LoginForm callbackPath={callbackPath} />
    </AuthShell>
  );
}
