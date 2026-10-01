"use client";

import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly Option<T>[];
  /** Accessible name for the group, e.g. "Theme". */
  label: string;
  /** `boxed` is the Settings look; `text` is the underlined tab look used on onboarding. */
  variant?: "boxed" | "text";
  className?: string;
};

// Radio-group semantics: one value is always selected, arrow keys move between options.
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  variant = "boxed",
  className,
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={label}
      orientation="horizontal"
      className={cn(
        variant === "boxed"
          ? "inline-flex overflow-hidden rounded-md border border-input"
          : "flex gap-5 border-b border-border",
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "type-body-md transition-colors duration-[120ms]",
            variant === "boxed"
              ? "h-11 px-4 text-muted-foreground hover:bg-accent md:h-8 md:px-3 " +
                  "data-[state=checked]:bg-primary-subtle data-[state=checked]:font-semibold data-[state=checked]:text-primary"
              : "-mb-px h-11 border-b-2 border-transparent text-muted-foreground md:h-9 " +
                  "data-[state=checked]:border-primary data-[state=checked]:font-semibold data-[state=checked]:text-foreground",
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
