"use client";

import { useState, useTransition } from "react";
import { changeEmail } from "@/actions/settings";
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
import { Input } from "@/components/ui/input";

export function ChangeEmailDialog({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setNewEmail("");
      setError(null);
      setFieldError(undefined);
      setSentTo(null);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    startTransition(async () => {
      const result = await changeEmail({ newEmail });
      if (!result.ok) {
        const field = result.error.fieldErrors?.newEmail;
        if (field) setFieldError(field);
        else setError(result.error.message);
        return;
      }
      setSentTo(newEmail);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost">Change email</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{sentTo ? "Check your inbox" : "Change your email"}</DialogTitle>
        {sentTo ? (
          <>
            <DialogDescription>
              We sent a link to {currentEmail}. Open it to approve switching to {sentTo}, then
              confirm the new address when we email it.
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogDescription>
              Your sign-in email changes after you approve it from your current address.
            </DialogDescription>
            {error ? <Alert className="mt-4">{error}</Alert> : null}
            <Field id="change-email-new" label="New email" error={fieldError} className="mt-4">
              {(a11y) => (
                <Input
                  {...a11y}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={pending || newEmail.trim() === ""}>
                {pending ? "Sending…" : "Send link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
