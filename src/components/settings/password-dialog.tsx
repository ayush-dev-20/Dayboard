"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { changePassword, setPassword } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ReauthNotice } from "./reauth-notice";

/** `change` asks for the current password; `set` is for accounts that signed up without one. */
export function PasswordDialog({ mode }: { mode: "change" | "set" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsRecentSignIn, setNeedsRecentSignIn] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(value: boolean) {
    setOpen(value);
    if (!value) {
      setCurrent("");
      setNext("");
      setErrors({});
      setFormError(null);
      setNeedsRecentSignIn(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setNeedsRecentSignIn(false);
    startTransition(async () => {
      const result =
        mode === "change"
          ? await changePassword({ currentPassword: current, newPassword: next })
          : await setPassword({ newPassword: next });

      if (!result.ok) {
        const fields = result.error.fieldErrors ?? {};
        if (fields.currentPassword || fields.newPassword) {
          setErrors({ current: fields.currentPassword, next: fields.newPassword });
        } else if (result.error.code === "UNAUTHENTICATED") {
          setNeedsRecentSignIn(true);
        } else {
          setFormError(result.error.message);
        }
        return;
      }
      toast(
        mode === "change" ? "Password changed. Other devices were signed out." : "Password set",
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          {mode === "change" ? "Change password" : "Set password"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{mode === "change" ? "Change your password" : "Set a password"}</DialogTitle>
        <form onSubmit={submit} noValidate>
          <DialogDescription>
            {mode === "change"
              ? "You will be signed out on your other devices."
              : "Then you can also sign in with your email and password."}
          </DialogDescription>
          {formError ? <Alert className="mt-4">{formError}</Alert> : null}
          {needsRecentSignIn ? (
            <ReauthNotice
              className="mt-4"
              message="For your security, sign in again before setting a password."
            />
          ) : null}
          <div className="mt-4 flex flex-col gap-4">
            {mode === "change" ? (
              <Field id="password-current" label="Current password" error={errors.current}>
                {(a11y) => (
                  <PasswordInput
                    {...a11y}
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <Field
              id="password-new"
              label="New password"
              hint="At least 10 characters."
              error={errors.next}
            >
              {(a11y) => (
                <PasswordInput
                  {...a11y}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={pending || next === "" || (mode === "change" && current === "")}
            >
              {pending ? "Saving…" : "Save password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
