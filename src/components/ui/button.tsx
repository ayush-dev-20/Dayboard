import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// One Primary per view region, then Secondary, then Ghost. Destructive appears only inside a
// confirm dialog or overflow menu. There is no fourth level (DESIGN.md).
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "type-label-md px-4 transition-colors duration-[120ms]",
    "disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    // 32px on desktop, 44px where a finger is the input
    "h-11 md:h-8",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-strong",
        secondary: "bg-secondary text-foreground hover:bg-accent",
        ghost: "px-3 text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}
