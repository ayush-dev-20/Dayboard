import * as React from "react";
import { cn } from "@/lib/utils";

// Surface fill, 1px `outline` boundary (3:1 on paper), 6px radius. 36px tall on desktop, 44px on
// touch with 16px text so iOS doesn't zoom on focus.
export const inputClasses =
  "block h-11 w-full rounded-md border border-input bg-background px-3 text-foreground md:h-9 md:text-[14px] " +
  "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-[invalid=true]:border-destructive";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}
