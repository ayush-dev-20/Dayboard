"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { BOARD_LIMITS } from "@/lib/canvas/board";

/**
 * "Add sticky note" at the foot of a column: an inline box. Enter adds it and opens another, Shift+Enter is a new line,
 * and Esc closes. Nothing is added empty.
 */
export function AddSticky({
  columnName,
  onAdd,
}: {
  columnName: string;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const field = box.current;
    const text = field?.value.trim() ?? "";
    if (!field || !text || busy) return;
    setBusy(true);
    const ok = await onAdd(text);
    setBusy(false);
    if (ok) {
      field.value = "";
      field.focus();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-2 mb-2 inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md px-2 type-body-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground md:h-8"
      >
        <Plus className="size-4" strokeWidth={1.5} aria-hidden />
        Add sticky note
        <span className="sr-only"> to {columnName}</span>
      </button>
    );
  }
  return (
    <div className="mx-2 mb-2">
      <textarea
        ref={box}
        autoFocus
        rows={2}
        maxLength={BOARD_LIMITS.stickyText}
        aria-label={`New sticky note in ${columnName}`}
        placeholder="Write a sticky note"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Emptied first, so leaving does not add what was typed.
            e.currentTarget.value = "";
            setOpen(false);
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        onBlur={(e) => {
          // Leaving with words typed adds them; leaving empty just closes.
          if (e.currentTarget.value.trim()) void submit().then(() => setOpen(false));
          else setOpen(false);
        }}
        className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-[14px]"
      />
      <p className="mt-1 type-body-sm text-muted-foreground">
        Enter adds it, Shift+Enter starts a new line, Esc closes.
      </p>
    </div>
  );
}
