"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { useCountdown } from "@/hooks/use-countdown";
import { AuthHeading, AuthLink } from "./auth-shell";

const RESEND_COOLDOWN_SECONDS = 30;

export function MagicLinkSentPanel({ email, next }: { email?: string; next: string }) {
  const { seconds, restart, active } = useCountdown(RESEND_COOLDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setError(null);
    restart(RESEND_COOLDOWN_SECONDS);
    const { error: failure } = await authClient.signIn.magicLink({
      email,
      callbackURL: next,
      newUserCallbackURL: "/onboarding",
      errorCallbackURL: "/sign-in",
    });
    if (failure) setError(describeAuthError(failure).message);
  }

  return (
    <>
      <AuthHeading
        title="Check your inbox"
        description={
          email
            ? `We sent a sign-in link to ${email}. It is valid for 10 minutes and works once.`
            : "We sent you a sign-in link. It is valid for 10 minutes and works once."
        }
      />
      {error ? <Alert className="mb-4">{error}</Alert> : null}
      {email ? (
        <Button variant="secondary" className="w-full" onClick={resend} disabled={active}>
          {active ? `Resend link (${seconds})` : "Resend link"}
        </Button>
      ) : null}
      <p className="mt-6 type-body-md">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </>
  );
}
