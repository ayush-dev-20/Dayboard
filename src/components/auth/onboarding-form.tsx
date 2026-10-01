"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/actions/onboarding";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useBrowserTimeZone, useIsClient } from "@/hooks/use-browser";
import { listTimeZones, timeZoneLabel, type TimeZoneOption } from "@/lib/dates/timezones";

type Theme = "light" | "dark" | "system";
const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

type Props = { initialName: string; initialTheme: Theme; next: string };

export function OnboardingForm({ initialName, initialTheme, next }: Props) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [name, setName] = useState(initialName);
  const [theme, setThemeValue] = useState<Theme>(initialTheme);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Detected from the browser. Until the person picks something, the select follows the detection.
  const detected = useBrowserTimeZone();
  const isClient = useIsClient();
  const [chosen, setChosen] = useState<string | null>(null);
  const timezone = chosen ?? detected;
  // One option on the server and during hydration so the markup matches, the full list afterwards.
  const zones: TimeZoneOption[] = isClient
    ? listTimeZones(detected)
    : [{ value: detected, label: timeZoneLabel(detected) }];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setNameError("Enter your name.");
      return;
    }
    setNameError(undefined);

    setPending(true);
    const result = await completeOnboarding({ name, timezone, theme });
    if (!result.ok) {
      setPending(false);
      setNameError(result.error.fieldErrors?.name);
      if (!result.error.fieldErrors?.name) setFormError(result.error.message);
      return;
    }
    setTheme(theme);
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? <Alert>{formError}</Alert> : null}

      <Field id="onboarding-name" label="Your name" error={nameError}>
        {(a11y) => (
          <Input
            {...a11y}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>

      <Field
        id="onboarding-timezone"
        label="Time zone"
        hint="Detected from your browser. Today and overdue use this."
      >
        {(a11y) => (
          <NativeSelect
            {...a11y}
            icon={Clock}
            value={timezone}
            onChange={(e) => setChosen(e.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label id="onboarding-theme-label">Theme</Label>
        <SegmentedControl
          label="Theme"
          variant="text"
          value={theme}
          onValueChange={setThemeValue}
          options={THEMES}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Continue to Today"}
      </Button>
    </form>
  );
}
