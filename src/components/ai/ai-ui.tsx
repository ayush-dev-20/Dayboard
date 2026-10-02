"use client";

import { Calendar, ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatPickerDay, parseDateString } from "@/lib/dates/calendar";
import { cn } from "@/lib/utils";
import type { AIFailure } from "./ai-client";

// Shared pieces of every AI surface. No sparkle icons and no "AI" badges (DESIGN.md): AI output is
// marked with the plain words "AI-GENERATED", and colour is never the only signal.

export function AiLabel({ children = "AI-generated" }: { children?: string }) {
  return <p className="type-label-caps text-muted-foreground">{children}</p>;
}

/** A tinted block for AI output. Hairlines elsewhere, but AI content is set apart on purpose. */
export function AiPanel({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-md bg-muted p-4", className)} {...props}>
      {children}
    </section>
  );
}

/** The Generating state: the word, then a few quiet bars. Motion only when the person allows it. */
export function AiGenerating({
  label = "Generating",
  lines = 3,
}: {
  label?: string;
  lines?: number;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      <p className="type-label-caps text-muted-foreground">{label}</p>
      <div className="mt-3 flex flex-col gap-2" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="h-2.5 rounded-sm bg-accent motion-safe:animate-pulse"
            style={{ width: `${88 - i * 14}%` }}
          />
        ))}
      </div>
    </div>
  );
}

type FailureProps = {
  error: AIFailure;
  /** What to say for a provider failure, e.g. "Couldn’t suggest subtasks. Nothing was changed." */
  text?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
};

/**
 * The Failed state. A rate limit is a calm amber note with the wait in it; anything else is a red
 * note with Retry. The words carry the meaning, not just the colour.
 */
export function AiFailureNotice({ error, text, onRetry, onDismiss, className }: FailureProps) {
  const limited = error.code === "RATE_LIMITED";
  const disabled = error.code === "AI_DISABLED";
  const message = limited || disabled || !text ? error.message : text;
  const Icon = limited ? TriangleAlert : CircleAlert;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 rounded-md px-4 py-3 type-body-md",
        limited ? "bg-warning-subtle text-warning" : "bg-destructive-subtle text-destructive",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1">{message}</p>
      {limited || disabled ? (
        onDismiss ? (
          <button type="button" onClick={onDismiss} className="shrink-0 font-semibold underline">
            Dismiss
          </button>
        ) : null
      ) : onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** A due date for a previewed task: shows the day, edits with a native date input. */
export function DueDateChip({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  /** Accessible name, e.g. "Due date for Send agenda". */
  label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value ? formatPickerDay(value) : "No date"}`}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 type-body-md hover:bg-accent md:h-8"
        >
          <Calendar className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <b className="font-semibold">{value ? formatPickerDay(value) : "No date"}</b>
          <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="flex flex-col gap-1.5">
          <p className="type-label-md">{label}</p>
          <Input
            type="date"
            aria-label={label}
            value={value ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "") onChange(null);
              else if (parseDateString(next)) onChange(next);
            }}
          />
        </div>
        {value ? (
          <PopoverClose asChild>
            <Button variant="ghost" className="mt-3" onClick={() => onChange(null)}>
              Clear date
            </Button>
          </PopoverClose>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
