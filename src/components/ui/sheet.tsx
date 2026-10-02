"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

type SheetContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "left" | "right" | "bottom";
};

// Docked edge is square (DESIGN.md). Used for the tablet sidebar now and the task detail later.
export function SheetContent({ side = "left", className, children, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col bg-overlay text-foreground shadow-float duration-300 float-surface dark:border-border",
          "data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "left" &&
            "left-0 w-sidebar max-w-[85vw] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left dark:border-r",
          side === "right" &&
            "right-0 w-full max-w-sheet data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right dark:border-l",
          side === "bottom" &&
            "inset-x-0 top-auto bottom-0 max-h-[85dvh] rounded-t-lg pb-[env(safe-area-inset-bottom)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom dark:border-t",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
