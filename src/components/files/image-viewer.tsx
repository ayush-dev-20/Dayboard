"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { fileUrl } from "@/lib/storage/dto";

/**
 * The full-size picture (V2 feature 09 §6): Esc or a click outside closes it and focus goes back
 * to where it was. Radix gives the focus trap, the title for screen readers and the Esc key.
 */
export function ImageViewer({
  attachmentId,
  label,
  open,
  onOpenChange,
}: {
  attachmentId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          onClick={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind a redirect */}
          <img
            src={fileUrl(attachmentId)}
            alt={label}
            className="max-h-full max-w-full rounded-md object-contain shadow-float"
          />
          <DialogPrimitive.Close
            aria-label="Close picture"
            className="absolute top-3 right-3 inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-overlay text-foreground shadow-float focus-visible:ring-2 focus-visible:ring-ring md:size-9"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
