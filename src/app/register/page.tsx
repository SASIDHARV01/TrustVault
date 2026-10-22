import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { getSafeCallbackPath } from "@/lib/auth-policy";
import { getCurrentSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({
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
      eyebrow="Start securely"
      title="Create your account"
      description="New accounts receive ordinary member access. Administrator status cannot be requested here."
    >
      <RegisterForm callbackPath={callbackPath} />
    </AuthShell>
  );
}
