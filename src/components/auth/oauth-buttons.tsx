"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type OAuthProvider = "google" | "github";

const LABELS: Record<OAuthProvider, string> = { google: "Google", github: "GitHub" };

type Props = {
  providers: OAuthProvider[];
  /** Where to land after signing in. Already validated by the caller. */
  callbackURL: string;
  onError: (message: string) => void;
};

/** Full-width secondary buttons above an "or" divider. Renders nothing when no provider is configured. */
export function OAuthButtons({ providers, callbackURL, onError }: Props) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    setPending(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL,
      newUserCallbackURL: "/onboarding",
      errorCallbackURL: "/sign-in",
    });
    if (error) {
      setPending(null);
      onError("We couldn't start that sign-in. Try again or use another method.");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            className="w-full"
            disabled={pending !== null}
            onClick={() => start(provider)}
          >
            {pending === provider ? "Redirecting…" : `Continue with ${LABELS[provider]}`}
          </Button>
        ))}
      </div>
      <div className="my-6 flex items-center gap-4" role="separator" aria-label="or">
        <span className="h-px flex-1 bg-border" />
        <span className="type-label-caps text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
