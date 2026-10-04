"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { AuthHeading } from "./auth-shell";
import { ResetLinkExpired } from "./reset-link-expired";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const next: typeof errors = {};
    if (password.length < 10) next.password = "Use at least 10 characters.";
    else if (password.length > 128) next.password = "Use 128 characters or fewer.";
    if (confirm !== password) next.confirm = "Those passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setPending(false);
      const failure = describeAuthError(error);
      if (failure.kind === "invalid-token") setExpired(true);
      else setFormError(failure.message);
      return;
    }
    router.replace("/sign-in?reset=1");
  }

  if (expired) return <ResetLinkExpired />;

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        description="You will be signed out on your other devices."
      />
      {formError ? <Alert className="mb-4">{formError}</Alert> : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          id="reset-password"
          label="New password"
          hint="At least 10 characters."
          error={errors.password}
        >
          {(a11y) => (
            <PasswordInput
              {...a11y}
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field id="reset-confirm" label="Confirm new password" error={errors.confirm}>
          {(a11y) => (
            <PasswordInput
              {...a11y}
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="mt-2 w-full" disabled={pending}>
          <KeyRound strokeWidth={1.5} aria-hidden />
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </>
  );
}
