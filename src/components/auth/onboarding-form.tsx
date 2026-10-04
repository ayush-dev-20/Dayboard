"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/actions/onboarding";
import { updatePreferences } from "@/actions/settings";
import { START_TIMES } from "@/components/settings/productivity-settings";
import { ThemePreview } from "@/components/settings/theme-setting";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect } from "@/components/ui/native-select";
import { useBrowserTimeZone, useIsClient } from "@/hooks/use-browser";
import { listTimeZones, timeZoneLabel, type TimeZoneOption } from "@/lib/dates/timezones";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const STEPS = ["You", "Look", "Start"] as const;

type Props = { initialName: string; initialTheme: Theme; initialStartOfDay: string; next: string };

/**
 * Three short steps in one route (feature 07 §9.6): You (required), Look and Start (optional).
 * Enter advances. "Continue to Today" finishes at any point, keeping the defaults for whatever was
 * skipped; only the optional steps can be skipped.
 */
export function OnboardingForm({ initialName, initialTheme, initialStartOfDay, next }: Props) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [theme, setThemeValue] = useState<Theme>(initialTheme);
  const [startOfDay, setStartOfDay] = useState(initialStartOfDay);
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

  function nameIsValid(): boolean {
    if (name.trim()) return true;
    setNameError("Enter your name.");
    setStep(0);
    return false;
  }

  async function finish() {
    setFormError(null);
    if (!nameIsValid()) return;
    setNameError(undefined);
    setPending(true);
    const result = await completeOnboarding({ name, timezone, theme });
    if (!result.ok) {
      setPending(false);
      setNameError(result.error.fieldErrors?.name);
      if (result.error.fieldErrors?.name) setStep(0);
      else setFormError(result.error.message);
      return;
    }
    if (startOfDay !== initialStartOfDay) {
      // Optional, so a failure here never blocks the way into the app; it can be changed in Settings.
      await updatePreferences({ startOfDay });
    }
    setTheme(theme);
    router.replace(next);
    router.refresh();
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (step === 0 && !nameIsValid()) return;
    setNameError(undefined);
    if (step < STEPS.length - 1) setStep(step + 1);
    else void finish();
  }

  function pickTheme(value: Theme) {
    setThemeValue(value);
    setTheme(value); // a live preview of the whole page
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <p className="type-body-sm text-muted-foreground" aria-live="polite">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={cn(
                "h-1 rounded-full transition-colors duration-200",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      {formError ? <Alert>{formError}</Alert> : null}

      {step === 0 ? (
        <>
          <Field id="onboarding-name" label="Your name" error={nameError}>
            {(a11y) => (
              <Input
                {...a11y}
                name="name"
                autoComplete="name"
                autoFocus
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
        </>
      ) : null}

      {step === 1 ? (
        <>
          <fieldset>
            <legend className="type-label-md text-foreground">Theme</legend>
            <div role="radiogroup" aria-label="Theme" className="mt-2 grid grid-cols-3 gap-2">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => pickTheme(option.value)}
                  className={cn(
                    "rounded-lg border bg-card p-1.5 text-left transition-[border-color,box-shadow] duration-150",
                    theme === option.value
                      ? "border-primary shadow-sm ring-1 ring-primary"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none block h-20 overflow-hidden rounded-md"
                  >
                    {option.value === "system" ? (
                      <span className="grid h-full grid-cols-2">
                        <span className="origin-top-left scale-[0.42] [&>div]:w-[238%]">
                          <ThemePreview mode="light" />
                        </span>
                        <span className="origin-top-left scale-[0.42] [&>div]:w-[238%]">
                          <ThemePreview mode="dark" />
                        </span>
                      </span>
                    ) : (
                      <span className="block origin-top-left scale-[0.42] [&>div]:w-[238%]">
                        <ThemePreview mode={option.value} />
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block px-1 type-label-md text-foreground">
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field
            id="onboarding-start"
            label="Start of day"
            hint="Today rolls over at this time, so late nights still count as the same day."
          >
            {(a11y) => (
              <NativeSelect
                {...a11y}
                icon={Clock}
                value={startOfDay}
                onChange={(e) => setStartOfDay(e.target.value)}
              >
                {START_TIMES.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <p className="type-body-md text-foreground">You&apos;re ready. Three things to know:</p>
          <ul className="flex flex-col gap-2.5 type-body-md text-foreground">
            <li className="flex items-center gap-3">
              <Kbd>C</Kbd> Capture a thought to your Inbox from any screen.
            </li>
            <li className="flex items-center gap-3">
              <Kbd>⌘K</Kbd> Search, ask or create from one menu.
            </li>
            <li className="flex items-center gap-3">
              <Kbd>N</Kbd> Add a task wherever you are.
            </li>
          </ul>
          <p className="type-body-sm text-muted-foreground">
            Today has a short getting-started list to try next.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 pt-1">
        {step < STEPS.length - 1 ? (
          <Button type="submit" className="w-full" disabled={pending}>
            Next
            <ArrowRight strokeWidth={1.5} aria-hidden />
          </Button>
        ) : null}
        <Button
          type={step === STEPS.length - 1 ? "submit" : "button"}
          variant={step === STEPS.length - 1 ? "primary" : "ghost"}
          className="w-full"
          disabled={pending}
          onClick={step === STEPS.length - 1 ? undefined : () => void finish()}
        >
          {pending ? "Saving…" : "Continue to Today"}
        </Button>
        {step > 0 ? (
          <Button
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft strokeWidth={1.5} aria-hidden /> Back
          </Button>
        ) : null}
      </div>
    </form>
  );
}
