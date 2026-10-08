"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// A sidebar section (the project list under Projects) that can be folded away with a chevron on
// its row. The choice is remembered on this device. Read through `useSyncExternalStore` so the
// server render (shown) and the first client render agree.

const listeners = new Set<() => void>();
const storageKey = (name: string) => `dayboard:sidebar:${name}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Whether the section is shown. Shown unless the person folded it. */
export function useSidebarSection(name: string) {
  const read = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey(name)) !== "0";
    } catch {
      return true;
    }
  }, [name]);
  const shown = useSyncExternalStore(subscribe, read, () => true);
  const setShown = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(storageKey(name), next ? "1" : "0");
      } catch {
        // Storage off: it still folds for this visit.
      }
      for (const listener of listeners) listener();
    },
    [name],
  );
  return { shown, setShown };
}

/** The chevron at the end of a section's row. */
export function SidebarSectionToggle({
  name,
  label,
  className,
}: {
  name: string;
  /** What it folds, lower case: "projects". */
  label: string;
  className?: string;
}) {
  const { shown, setShown } = useSidebarSection(name);
  return (
    <button
      type="button"
      onClick={() => setShown(!shown)}
      aria-expanded={shown}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:size-6",
        className,
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
          shown && "rotate-90",
        )}
        strokeWidth={1.5}
        aria-hidden
      />
    </button>
  );
}
