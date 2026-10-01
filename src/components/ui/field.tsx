import * as React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  /** Receives the ids the control needs for labels, hints and errors. */
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
};

/** Label above the control, optional hint, and an inline error with icon and words (never color alone). */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy || undefined,
      })}
      <div aria-live="polite">
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 type-body-sm text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p id={hintId} className="type-body-sm text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
