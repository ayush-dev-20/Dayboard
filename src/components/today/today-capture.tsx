"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { saveToInbox } from "@/components/command/capture";
import { INBOX_TEXT_MAX } from "@/lib/validations/inbox";

/** A quiet one-line "Capture to Inbox" under the greeting: type, Enter, done. Failure keeps the text. */
export function TodayCapture() {
  const [text, setText] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText(""); // ready for the next thought at once
    const result = await saveToInbox(value);
    if (!result.ok) {
      setText(value);
      toast.error("Couldn't save that. Your text is still here.", {
        action: { label: "Retry", onClick: () => void save(event) },
      });
      return;
    }
    toast("Saved to Inbox.");
  }

  return (
    <form
      onSubmit={save}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-primary focus-within:shadow-sm"
    >
      <Plus className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={INBOX_TEXT_MAX}
        placeholder="Capture to Inbox"
        aria-label="Capture to Inbox"
        autoComplete="off"
        className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:h-11 md:text-[14px]"
      />
      <span className="hidden shrink-0 items-center gap-1.5 type-body-sm text-muted-foreground md:inline-flex">
        <Kbd>C</Kbd> from anywhere
      </span>
    </form>
  );
}
