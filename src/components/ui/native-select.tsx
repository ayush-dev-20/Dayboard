import * as React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClasses } from "./input";

type NativeSelectProps = React.ComponentProps<"select"> & {
  icon?: LucideIcon;
  /** `field` looks like an input; `inline` is the bold, borderless picker used in settings rows. */
  appearance?: "field" | "inline";
  wrapperClassName?: string;
};

// A native <select> on purpose: the time zone list has ~400 entries, and the platform picker is
// the fastest, most accessible control for that on desktop and on phones.
export function NativeSelect({
  className,
  icon: Icon,
  appearance = "field",
  wrapperClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "relative",
        appearance === "inline" && "inline-block max-w-full",
        wrapperClassName,
      )}
    >
      {Icon ? (
        <Icon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
      ) : null}
      <select
        className={cn(
          inputClasses,
          "appearance-none pr-9",
          Icon ? "pl-9" : undefined,
          appearance === "inline" &&
            "w-auto max-w-full cursor-pointer border-transparent font-semibold hover:bg-accent",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
    </div>
  );
}
