"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { firstValidationError, loginSchema } from "@/lib/auth-validation";

export function LoginForm({ callbackPath }: { callbackPath: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = loginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!result.success) {
      setError(firstValidationError(result.error));
      return;
    }

    setPending(true);

    const response = await authClient.signIn.email({
      ...result.data,
      rememberMe: form.get("rememberMe") === "on",
    });

    if (response.error) {
      setError("Email or password is incorrect, or the account is unavailable.");
      setPending(false);
      return;
    }

    router.replace(callbackPath);
  }

  return (
    <form className="auth-form" method="post" onSubmit={handleSubmit} noValidate>
      <label>
        Email address
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          placeholder="you@company.com"
          type="email"
          required
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          name="password"
          placeholder="Enter your password"
          type="password"
          required
        />
      </label>
      <label className="auth-form__check">
        <input defaultChecked name="rememberMe" type="checkbox" />
        Keep me signed in on this device
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button--primary auth-submit" disabled={pending} type="submit">
        {pending ? "Verifying…" : "Enter the vault"}
      </button>
      <p className="auth-form__switch">
        New to TrustVault? <Link href={`/register?next=${encodeURIComponent(callbackPath)}`}>Create an account</Link>
      </p>
    </form>
  );
}
