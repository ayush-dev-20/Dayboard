import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "rounded-sm bg-secondary px-1 py-0.5 type-kbd text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
