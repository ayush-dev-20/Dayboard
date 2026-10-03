"use client";

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
        {/* The tick draws itself in 150ms after the box fills (stroke, not transform, so it also
            plays gently under reduced motion, where the global rule makes it instant). */}
        <svg viewBox="0 0 12 12" aria-hidden className="size-3 overflow-visible">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={checked ? 0 : 1}
            className="transition-[stroke-dashoffset] delay-[60ms] duration-150 ease-(--ease-enter)"
          />
        </svg>
      </span>
    </button>
  );
}
