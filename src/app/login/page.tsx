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
      eyebrow="Secure gateway // returning identity"
      title="Authenticate to enter"
      description="Connect the identity assigned to your confidential document workspace."
    >
      <LoginForm callbackPath={callbackPath} />
    </AuthShell>
  );
}
