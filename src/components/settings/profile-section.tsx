"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProfile } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsRow } from "./settings-ui";
import { ChangeEmailDialog } from "./change-email-dialog";

type Props = { name: string; email: string; emailVerified: boolean };

export function ProfileSection({ name, email, emailVerified }: Props) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const unchanged = value.trim() === name;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({ name: value });
      if (!result.ok) {
        setError(result.error.fieldErrors?.name ?? result.error.message);
        return;
      }
      setValue(result.data.name);
      toast("Saved");
    });
  }

  return (
    <>
      <form
        onSubmit={save}
        className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border py-3"
      >
        <Label htmlFor="profile-name">Name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "profile-name-error" : undefined}
            className="w-56"
          />
          <Button type="submit" variant="secondary" disabled={pending || unchanged}>
            Save
          </Button>
        </div>
        {error ? (
          <p
            id="profile-name-error"
            role="alert"
            className="basis-full text-right type-body-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </form>

      <SettingsRow
        title="Email"
        description={`${email} · ${emailVerified ? "verified" : "not verified"}`}
      >
        <ChangeEmailDialog currentEmail={email} />
      </SettingsRow>
    </>
  );
}
