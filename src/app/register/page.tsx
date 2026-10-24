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
      eyebrow="New identity // member clearance"
      title="Create your secure identity"
      description="New identities receive member clearance. Administrator authority can only originate from trusted server data."
    >
      <RegisterForm callbackPath={callbackPath} />
    </AuthShell>
  );
}
