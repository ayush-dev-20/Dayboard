"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { useIsClient } from "@/hooks/use-browser";
import { cn } from "@/lib/utils";

const ORDER = ["light", "dark", "system"] as const;
type Theme = (typeof ORDER)[number];
const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Cycles Light → Dark → System and saves it to the account, like Settings → Appearance. */
export function ThemeToggle({ className }: { className?: string }) {
  const isClient = useIsClient();
  const { theme, setTheme } = useTheme();
  const current: Theme = isClient && ORDER.includes(theme as Theme) ? (theme as Theme) : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  const Icon = ICON[current];

  async function change() {
    setTheme(next);
    const result = await updatePreferences({ theme: next });
    if (!result.ok) {
      setTheme(current);
      toast.error(result.error.message);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void change()}
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}
