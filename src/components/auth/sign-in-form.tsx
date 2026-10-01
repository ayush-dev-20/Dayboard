"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { AuthLink } from "./auth-shell";
import { OAuthButtons, type OAuthProvider } from "./oauth-buttons";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  next: string;
  providers: OAuthProvider[];
  /** Server-decided banner from the URL (expired link, failed provider, password just reset). */
  notice?: { tone: "error" | "info"; message: string } | null;
};

export function SignInForm({ next, providers, notice }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);
  const [linkPending, setLinkPending] = useState(false);

  const nextQuery = next === "/today" ? "" : `?next=${encodeURIComponent(next)}`;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: typeof fieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });

    if (error) {
      const failure = describeAuthError(error);
      setPending(false);
      if (failure.kind === "email-not-verified") {
        router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setFormError(failure.message);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  async function sendMagicLink() {
    setFormError(null);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setFieldErrors({ email: "Enter your email first, then ask for a sign-in link." });
      document.getElementById("signin-email")?.focus();
      return;
    }
    setFieldErrors({});
    setLinkPending(true);

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: next,
      newUserCallbackURL: "/onboarding",
      errorCallbackURL: "/sign-in",
    });
    setLinkPending(false);

    if (error) {
      setFormError(describeAuthError(error).message);
      return;
    }
    const params = new URLSearchParams({ email: email.trim() });
    if (next !== "/today") params.set("next", next);
    router.push(`/magic-link-sent?${params.toString()}`);
  }

  const banner = formError ? { tone: "error" as const, message: formError } : notice;

  return (
    <>
      {banner ? (
        <Alert tone={banner.tone} className="mb-6">
          {banner.message}
        </Alert>
      ) : null}

      <OAuthButtons providers={providers} callbackURL={next} onError={setFormError} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field id="signin-email" label="Email" error={fieldErrors.email}>
          {(a11y) => (
            <Input
              {...a11y}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field id="signin-password" label="Password" error={fieldErrors.password}>
          {(a11y) => (
            <PasswordInput
              {...a11y}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <div className="flex items-center justify-between gap-4 type-body-md">
          <AuthLink href="/forgot-password">Forgot password?</AuthLink>
          <button
            type="button"
            onClick={sendMagicLink}
            disabled={linkPending}
            className="text-primary underline underline-offset-2 hover:text-primary-strong disabled:opacity-60"
          >
            {linkPending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </div>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 type-body-md text-muted-foreground">
        New to Dayboard? <AuthLink href={`/sign-up${nextQuery}`}>Create an account</AuthLink>
      </p>
    </>
  );
}
