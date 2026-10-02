"use client";

import { Check } from "lucide-react";
import { COLOR_LABELS, COLOR_TOKENS, colorVar, type ColorToken } from "@/lib/colors";
import { cn } from "@/lib/utils";

type Props = {
  value: ColorToken | null;
  onChange: (color: ColorToken) => void;
  /** Accessible name of the group, e.g. "Colour". */
  label: string;
  className?: string;
};

/** A row of the eight colour tokens. A tick marks the chosen one, so colour isn't the only cue. */
export function ColorSwatches({ value, onChange, label, className }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {COLOR_TOKENS.map((token) => {
        const selected = value === token;
        return (
          <button
            key={token}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={COLOR_LABELS[token]}
            onClick={() => onChange(token)}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-full border transition-colors duration-[120ms] md:size-8",
              selected ? "border-foreground" : "border-border hover:border-input",
            )}
          >
            <span
              className="inline-flex size-4 items-center justify-center rounded-full"
              style={{ backgroundColor: colorVar(token) }}
            >
              {selected ? (
                <Check className="size-3 text-white" strokeWidth={2.5} aria-hidden />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
