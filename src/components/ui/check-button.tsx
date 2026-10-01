"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Complete Send invoice". */
  label: string;
  /** Tasks are square, Todos are round: the shape alone tells them apart (DESIGN.md). */
  shape?: "square" | "round";
  disabled?: boolean;
  className?: string;
  tabIndex?: number;
};

// An 18px box in a 36px hit area (44px on touch). The box is the only thing that looks interactive.
export function CheckButton({
  checked,
  onCheckedChange,
  label,
  shape = "square",
  disabled,
  className,
  tabIndex,
}: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange(!checked);
      }}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md md:size-9",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-[18px] items-center justify-center border transition-colors duration-[120ms]",
          shape === "square" ? "rounded-sm" : "rounded-full",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={2} aria-hidden /> : null}
      </span>
    </button>
  );
}
