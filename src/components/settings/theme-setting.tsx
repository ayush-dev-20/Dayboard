"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { SettingsRow } from "./settings-ui";

type Theme = "light" | "dark" | "system";
const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export function ThemeSetting({ initial }: { initial: Theme }) {
  const { setTheme } = useTheme();
  const [value, setValue] = useState<Theme>(initial);

  async function change(next: Theme) {
    const previous = value;
    setValue(next);
    setTheme(next);
    const result = await updatePreferences({ theme: next });
    if (!result.ok) {
      setValue(previous);
      setTheme(previous);
      toast.error(result.error.message);
    }
  }

  return (
    <>
      <SettingsRow title="Theme" description="System follows your device.">
        <SegmentedControl label="Theme" value={value} onValueChange={change} options={OPTIONS} />
      </SettingsRow>

      <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-hidden>
        <ThemePreview mode="light" />
        <ThemePreview mode="dark" />
      </div>
    </>
  );
}

// A tiny rendering of a task list in each theme. `.light` / `.dark` re-scope the color tokens.
export function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  return (
    <div className={cn(mode, "rounded-lg border border-border bg-background p-4 text-foreground")}>
      <p className="type-headline-sm">{mode === "light" ? "Light" : "Dark"}</p>
      <div className="mt-3 flex items-center gap-3 border-b border-border py-2">
        <span className="size-[18px] rounded-sm border border-input" />
        <span className="type-body-md">Prepare client call notes</span>
      </div>
      <div className="flex items-center gap-3 py-2 text-muted-foreground">
        <span className="flex size-[18px] items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <svg
            viewBox="0 0 12 12"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="m2.5 6.2 2.3 2.3 4.7-5" />
          </svg>
        </span>
        <span className="type-body-md line-through">Send agenda</span>
      </div>
    </div>
  );
}
