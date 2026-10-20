"use client";

import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLOR_LABELS, COLOR_TOKENS, colorVar, type ColorToken } from "@/lib/colors";
import { cn } from "@/lib/utils";

/**
 * A colour for a sticky note or a column: eight swatches and "No colour". The chosen one is marked with a check as well as a
 * ring, and every swatch has its name, so colour is never the only way to tell them apart.
 */
export function TonePicker({
  value,
  onChange,
  label,
  children,
  align = "start",
  open,
  onOpenChange,
}: {
  value: ColorToken | null;
  onChange: (tone: ColorToken | null) => void;
  /** What is being coloured, for the accessible names: "Colour of the sticky note". */
  label: string;
  /** The button that opens the picker. */
  children: React.ReactNode;
  align?: "start" | "end";
  /** Set both to open it from somewhere else (a menu item), with `children` as the place it appears beside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-2">
        <div role="group" aria-label={label} className="grid grid-cols-5 gap-1">
          <Swatch name="No colour" selected={value === null} onSelect={() => onChange(null)} />
          {COLOR_TOKENS.map((token) => (
            <Swatch
              key={token}
              name={COLOR_LABELS[token]}
              color={token}
              selected={value === token}
              onSelect={() => onChange(token)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Swatch({
  name,
  color,
  selected,
  onSelect,
}: {
  name: string;
  color?: ColorToken;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={selected}
      title={name}
      onClick={onSelect}
      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-8"
    >
      <span
        aria-hidden
        style={color ? { backgroundColor: colorVar(color) } : undefined}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full border",
          color ? "border-transparent" : "border-input bg-background",
          selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
      >
        {selected ? <Check className="size-3 text-foreground" strokeWidth={2} aria-hidden /> : null}
      </span>
    </button>
  );
}
