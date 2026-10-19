"use client";

import { createContext, useContext, useMemo } from "react";
import Link from "next/link";
import { Maximize2, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Frame = { expandHref: string; close: () => void };

const FrameContext = createContext<Frame | null>(null);

/** Set while inside an {@link ExpandableDialog}; null on a full page. Lets shared content tell the two apart. */
export function useExpandableDialog(): Frame | null {
  return useContext(FrameContext);
}

const iconButton =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:size-8";

/**
 * The Expand and Close buttons. The content puts them where they belong in its own header (a note puts them
 * after its menu), so the frame needs no bar of its own and the buttons sit in line with the rest.
 */
export function ExpandableDialogActions({ className }: { className?: string }) {
  const frame = useExpandableDialog();
  if (!frame) return null;
  return (
    <span className={cn("flex items-center", className)}>
      <Link
        href={frame.expandHref}
        aria-label="Open as a full page"
        title="Open as a full page"
        className={iconButton}
      >
        <Maximize2 className="size-4" strokeWidth={1.5} aria-hidden />
      </Link>
      <DialogClose aria-label="Close" title="Close" className={iconButton}>
        <X className="size-4" strokeWidth={1.5} aria-hidden />
      </DialogClose>
    </span>
  );
}

/**
 * A large dialog for peeking at a record without leaving the page: 80% of the screen's width and height from
 * tablet width up, nearly the whole screen on a phone (80% of 360px is too narrow to write in). The content
 * scrolls inside it. "Expand" is a link to the record's own page, so it works with the keyboard, opens in a new
 * tab, and needs no script. Place {@link ExpandableDialogActions} in the content.
 *
 * The dialog is controlled by the caller, usually from a URL parameter, so the Back button closes it and the
 * address can be shared.
 */
export function ExpandableDialog({
  open = true,
  onClose,
  expandHref,
  title,
  className,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  /** The record's own page. */
  expandHref: string;
  /** Read out by a screen reader; not drawn. */
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const frame = useMemo(() => ({ expandHref, close: onClose }), [expandHref, onClose]);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex max-w-none flex-col overflow-hidden p-0",
          "h-[calc(100dvh-16px)] w-[calc(100%-16px)] md:h-[80dvh] md:w-[80vw]",
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        <FrameContext.Provider value={frame}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </FrameContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
