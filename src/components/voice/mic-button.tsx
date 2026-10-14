"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceAvailable } from "./use-voice-available";
import { requestVoice } from "./voice-context";

/** The microphone beside a capture box (V2 feature 13 §3). Renders nothing where voice is off or unsupported. */
export function MicButton({
  className,
  onBefore,
}: {
  className?: string;
  /** Runs first, for example to close the menu this button sits in (dialogs are never nested). */
  onBefore?: () => void;
}) {
  const available = useVoiceAvailable();
  if (!available) return null;
  return (
    <button
      type="button"
      aria-label="Record a voice capture"
      onClick={() => {
        onBefore?.();
        requestVoice();
      }}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:size-8",
        className,
      )}
    >
      <Mic className="size-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}
