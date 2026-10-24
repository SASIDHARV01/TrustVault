"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/login");
  }

  return (
    <button className="app-nav__signout" disabled={pending} onClick={signOut} type="button">
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
