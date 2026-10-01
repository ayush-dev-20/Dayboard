"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { useCountdown } from "@/hooks/use-countdown";
import { AuthHeading, AuthLink } from "./auth-shell";

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailPanel({ email }: { email?: string }) {
  // The first email was just sent by the previous screen, so start in cooldown.
  const { seconds, restart, active } = useCountdown(email ? RESEND_COOLDOWN_SECONDS : 0);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setError(null);
    restart(RESEND_COOLDOWN_SECONDS);
    const { error: failure } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/today",
    });
    if (failure) setError(describeAuthError(failure).message);
  }

  return (
    <>
      <AuthHeading
        title="Check your inbox"
        description={
          email
            ? `We sent a verification link to ${email}. Open it to finish creating your account.`
            : "We sent you a verification link. Open it to finish creating your account."
        }
      />

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      {email ? (
        <>
          <Button variant="secondary" className="w-full" onClick={resend} disabled={active}>
            Resend email
          </Button>
          <p className="mt-2 type-body-sm text-muted-foreground" aria-live="polite">
            {active
              ? `You can ask for another email in ${seconds} seconds.`
              : "Didn't get it? Check spam, or resend."}
          </p>
          <p className="mt-6 type-body-md">
            <AuthLink href="/sign-up">Use a different email</AuthLink>
          </p>
        </>
      ) : null}

      <p className="mt-6 type-body-md text-muted-foreground">
        Wrong account? <AuthLink href="/sign-in">Sign in</AuthLink>
      </p>
    </>
  );
}
