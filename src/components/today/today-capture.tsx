"use client";

import { useState } from "react";
import { toast } from "sonner";
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
      className="border-b border-border transition-colors duration-[120ms] focus-within:border-primary"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={INBOX_TEXT_MAX}
        placeholder="Capture to Inbox"
        aria-label="Capture to Inbox"
        autoComplete="off"
        className="h-11 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:h-9 md:text-[14px]"
      />
    </form>
  );
}
