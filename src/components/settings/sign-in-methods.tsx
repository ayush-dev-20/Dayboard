"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unlinkProvider } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { PasswordDialog } from "./password-dialog";
import { ReauthNotice } from "./reauth-notice";
import { SettingsRow } from "./settings-ui";

type Provider = "google" | "github";
const LABELS: Record<Provider, string> = { google: "Google", github: "GitHub" };

type Props = {
  email: string;
  /** Preformatted on the server, e.g. "Sep 20". Null when there is no password yet. */
  passwordSetOn: string | null;
  /** Linked providers with a preformatted link date. */
  linked: Partial<Record<Provider, string>>;
  /** Providers configured on this deployment. Unconfigured, unlinked ones are not shown. */
  available: Provider[];
};

export function SignInMethods({ email, passwordSetOn, linked, available }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsRecentSignIn, setNeedsRecentSignIn] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [, startTransition] = useTransition();

  const visible = (["google", "github"] as const).filter((p) => available.includes(p) || linked[p]);

  function unlink(provider: Provider) {
    setError(null);
    setNeedsRecentSignIn(false);
    setPendingProvider(provider);
    startTransition(async () => {
      const result = await unlinkProvider({ provider });
      setPendingProvider(null);
      if (!result.ok) {
        // Unlinking needs a sign-in from the last ten minutes.
        if (result.error.code === "UNAUTHENTICATED") setNeedsRecentSignIn(true);
        else setError(result.error.message);
        return;
      }
      toast(`${LABELS[provider]} unlinked`);
      router.refresh();
    });
  }

  async function link(provider: Provider) {
    setError(null);
    setPendingProvider(provider);
    const { error: failure } = await authClient.linkSocial({
      provider,
      callbackURL: "/settings/account",
    });
    if (failure) {
      setPendingProvider(null);
      setError("We couldn't start that. Try again in a moment.");
    }
  }

  return (
    <>
      {error ? <Alert className="my-3">{error}</Alert> : null}
      {needsRecentSignIn ? (
        <ReauthNotice
          className="my-3"
          message="For your security, sign in again to remove a sign-in method."
        />
      ) : null}

      <SettingsRow
        title="Password"
        description={passwordSetOn ? `Set on ${passwordSetOn}` : "Not set"}
      >
        <PasswordDialog mode={passwordSetOn ? "change" : "set"} />
      </SettingsRow>

      {visible.map((provider) => {
        const linkedOn = linked[provider];
        return (
          <SettingsRow
            key={provider}
            title={LABELS[provider]}
            description={linkedOn ? `Linked on ${linkedOn}` : "Not linked"}
          >
            {linkedOn ? (
              <Button
                variant="ghost"
                disabled={pendingProvider === provider}
                onClick={() => unlink(provider)}
              >
                Unlink
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={pendingProvider === provider}
                onClick={() => link(provider)}
              >
                Link {LABELS[provider]}
              </Button>
            )}
          </SettingsRow>
        );
      })}

      <SettingsRow title="Magic link" description={`Available for ${email}`}>
        <span className="type-body-md text-muted-foreground">Always on</span>
      </SettingsRow>
    </>
  );
}
