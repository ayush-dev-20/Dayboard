"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useIsClient } from "@/hooks/use-browser";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Light / Dark / System for a visitor (kept in this browser; there is no account yet). */
export function LandingThemeToggle() {
  const isClient = useIsClient();
  const { theme, setTheme } = useTheme();
  const current = isClient ? (theme ?? "system") : "system";
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md bg-secondary p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-sm transition-colors duration-150 md:size-7",
            current === value
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
      ))}
    </div>
  );
}
