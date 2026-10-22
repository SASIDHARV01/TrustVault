import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  getLoginPath,
  isAccountActive,
  isAdministrator,
} from "@/lib/auth-policy";
import { auth, type AuthSession } from "@/lib/server/auth";

export async function getCurrentSession(): Promise<AuthSession | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !isAccountActive(session.user.disabledAt)) {
    return null;
  }

  return session;
}

export async function requireSession(callbackPath = "/vault") {
  const session = await getCurrentSession();

  if (!session) {
    redirect(getLoginPath(callbackPath));
  }

  return session;
}

export async function requireAdministrator(callbackPath = "/admin") {
  const session = await requireSession(callbackPath);

  if (!isAdministrator(session.user.role)) {
    redirect("/vault?notice=admin-required");
  }

  return session;
}
