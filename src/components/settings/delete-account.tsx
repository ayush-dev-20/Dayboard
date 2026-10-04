"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { SettingsRow } from "./settings-ui";

type Provider = "google" | "github";
const LABELS: Record<Provider, string> = { google: "Google", github: "GitHub" };
const RETURN_URL = "/settings/account?delete=1";

type Props = {
  email: string;
  hasPassword: boolean;
  linkedProviders: Provider[];
  /** Reopen straight away after the person signed in again to confirm it's them. */
  defaultOpen?: boolean;
};

type Step = "closed" | "confirm" | "reauth";

export function DeleteAccount({ email, hasPassword, linkedProviders, defaultOpen = false }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(defaultOpen ? "confirm" : "closed");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    setPending(true);
    const result = await deleteAccount({ confirmation: "DELETE" });
    setPending(false);

    if (result.ok) {
      router.replace("/sign-in?deleted=1");
      router.refresh();
      return;
    }
    // A session older than ten minutes must sign in again first.
    if (result.error.code === "UNAUTHENTICATED") {
      setStep("reauth");
      return;
    }
    setError(result.error.message);
  }

  return (
    <>
      <SettingsRow
        title="Delete account"
        description="Removes your account and all tasks, todos, notes, projects and tags. This can’t be undone."
      >
        <Button variant="destructive" onClick={() => setStep("confirm")}>
          <Trash2 strokeWidth={1.5} aria-hidden />
          Delete account
        </Button>
      </SettingsRow>

      <ConfirmDialog
        open={step === "confirm"}
        onOpenChange={(open) => setStep(open ? "confirm" : "closed")}
        title="Delete your account?"
        description="This permanently deletes your account and everything in it: tasks, todos, notes, projects, tags and AI usage. Backups may keep copies until they rotate out."
        confirmLabel="Delete my account"
        requireText="DELETE"
        destructive
        pending={pending}
        error={error}
        onConfirm={confirmDelete}
      />

      <ReauthDialog
        open={step === "reauth"}
        onOpenChange={(open) => setStep(open ? "reauth" : "closed")}
        email={email}
        hasPassword={hasPassword}
        linkedProviders={linkedProviders}
        onPasswordOk={() => setStep("confirm")}
      />
    </>
  );
}

function ReauthDialog({
  open,
  onOpenChange,
  email,
  hasPassword,
  linkedProviders,
  onPasswordOk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  hasPassword: boolean;
  linkedProviders: Provider[];
  onPasswordOk: () => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function withPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: failure } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (failure) {
      setError(describeAuthError(failure).message);
      return;
    }
    setPassword("");
    router.refresh();
    onPasswordOk();
  }

  async function withProvider(provider: Provider) {
    setError(null);
    const { error: failure } = await authClient.signIn.social({
      provider,
      callbackURL: RETURN_URL,
    });
    if (failure) setError("We couldn't start that. Try again in a moment.");
  }

  async function withMagicLink() {
    setError(null);
    setPending(true);
    const { error: failure } = await authClient.signIn.magicLink({
      email,
      callbackURL: RETURN_URL,
      errorCallbackURL: "/sign-in",
    });
    setPending(false);
    if (failure) setError(describeAuthError(failure).message);
    else setLinkSent(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Confirm it’s you</DialogTitle>
        <DialogDescription>
          For your security, sign in again to delete your account. Use any method linked to it.
        </DialogDescription>

        {error ? <Alert className="mt-4">{error}</Alert> : null}

        {linkSent ? (
          <Alert tone="info" className="mt-4">
            We sent a sign-in link to {email}. Open it, and you’ll come back here to finish.
          </Alert>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {linkedProviders.map((provider) => (
              <Button
                key={provider}
                variant="secondary"
                className="w-full"
                onClick={() => withProvider(provider)}
              >
                Continue with {LABELS[provider]}
              </Button>
            ))}
            <Button
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={withMagicLink}
            >
              Email me a sign-in link
            </Button>
          </div>
        )}

        {hasPassword && !linkSent ? (
          <form
            onSubmit={withPassword}
            noValidate
            className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          >
            <Field id="reauth-password" label="Or use your password">
              {(a11y) => (
                <PasswordInput
                  {...a11y}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" disabled={pending || password === ""}>
              Continue
            </Button>
          </form>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
