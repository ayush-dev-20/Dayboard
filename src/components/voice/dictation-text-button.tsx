"use client";

import { Mic } from "lucide-react";
import { useDictation, useDictationSupported } from "@/components/editor/use-dictation";
import { formatDictation, opsToText } from "@/lib/dictation/format";
import { cn } from "@/lib/utils";

/**
 * Dictate into a plain text box (the capture boxes): what is heard is capitalised and punctuated and typed in at the
 * cursor. Renders nothing in a browser that cannot recognise speech. It sits beside the voice-capture microphone where
 * that is offered: "Dictate" types into this box, "Record a voice capture" records, transcribes and lets you review
 * before anything is created.
 */
export function DictationTextButton({
  inputRef,
  singleLine,
  value,
  onChange,
  maxLength,
  className,
}: {
  /** The box being dictated into. */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** A one-line box: a spoken new line becomes a space. */
  singleLine?: boolean;
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  className?: string;
}) {
  const supported = useDictationSupported();
  const { listening, toggle } = useDictation((heard, commands) => {
    const box = inputRef.current;
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? value.length;
    // Formatting looks at the last line before the cursor, so a new line starts with a capital letter.
    const before = value.slice(0, start);
    const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
    const spoken = opsToText(formatDictation(heard, { before: lineBefore, commands }));
    const piece = singleLine ? spoken.replace(/\s*\n+\s*/g, " ") : spoken;
    if (!piece) return;
    const next = value.slice(0, start) + piece + value.slice(end);
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    const caret = start + piece.length;
    requestAnimationFrame(() => box?.setSelectionRange(caret, caret));
  });
  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        aria-label={listening ? "Stop dictating" : "Dictate"}
        aria-pressed={listening}
        title={listening ? "Stop dictating" : "Dictate"}
        // Keep the cursor where it is in the box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className={cn(
          "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:size-8",
          listening && "bg-primary-subtle text-primary",
          className,
        )}
      >
        <Mic className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
      <span role="status" className="sr-only">
        {listening ? "Dictating" : ""}
      </span>
    </>
  );
}
