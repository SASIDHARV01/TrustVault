"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import {
  firstValidationError,
  registrationSchema,
} from "@/lib/auth-validation";

export function RegisterForm({ callbackPath }: { callbackPath: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = registrationSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!result.success) {
      setError(firstValidationError(result.error));
      return;
    }

    setPending(true);
    const response = await authClient.signUp.email(result.data);

    if (response.error) {
      setError(
        response.error.status === 422
          ? "An account with this email may already exist. Try signing in."
          : "We could not create the account. Check the details and try again.",
      );
      setPending(false);
      return;
    }

    router.replace(callbackPath);
  }

  return (
    <form className="auth-form" method="post" onSubmit={handleSubmit} noValidate>
      <label>
        Full name
        <input
          autoComplete="name"
          maxLength={120}
          name="name"
          placeholder="Your name"
          required
        />
      </label>
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
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          name="password"
          placeholder="At least 12 characters"
          type="password"
          required
        />
        <small>Use 12–128 characters. A password manager is recommended.</small>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button--primary auth-submit" disabled={pending} type="submit">
        {pending ? "Creating account…" : "Create secure account"}
      </button>
      <p className="auth-form__switch">
        Already have an account? <Link href={`/login?next=${encodeURIComponent(callbackPath)}`}>Sign in</Link>
      </p>
    </form>
  );
}
