"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { useCountdown } from "@/hooks/use-countdown";
import { AuthHeading, AuthLink } from "./auth-shell";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 30;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const { seconds, restart, active } = useCountdown(0);

  async function request() {
    setFormError(null);
    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: "/reset-password",
    });
    setPending(false);

    // Rate limits are worth saying out loud. Anything else looks the same whether or not the
    // account exists, so the screen never reveals which emails are registered.
    if (error && describeAuthError(error).kind === "rate-limited") {
      setFormError(describeAuthError(error).message);
      return;
    }
    setSent(true);
    restart(RESEND_COOLDOWN_SECONDS);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(undefined);
    await request();
  }

  if (sent) {
    return (
      <>
        <AuthHeading
          title="Check your inbox"
          description="If an account exists for that email, we’ve sent a link. It works once and expires soon."
        />
        {formError ? <Alert className="mb-4">{formError}</Alert> : null}
        <Button
          variant="secondary"
          className="w-full"
          onClick={request}
          disabled={pending || active}
        >
          {active ? `Resend link (${seconds})` : "Resend link"}
        </Button>
        <p className="mt-6 type-body-md">
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Reset your password"
        description="Enter your email and we will send you a link."
      />
      {formError ? <Alert className="mb-4">{formError}</Alert> : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field id="forgot-email" label="Email" error={emailError}>
          {(a11y) => (
            <Input
              {...a11y}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <p className="mt-6 type-body-md">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </>
  );
}
