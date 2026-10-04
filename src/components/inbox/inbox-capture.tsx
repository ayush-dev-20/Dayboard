"use client";

import { Inbox } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { saveToInbox } from "@/components/command/capture";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { INBOX_TEXT_MAX } from "@/lib/validations/inbox";

/** The textarea at the top of the Inbox: write anything, Cmd/Ctrl+Enter or Capture saves, and the box clears for the next one. */
export function InboxCapture() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    const result = await saveToInbox(value);
    setSaving(false);
    if (!result.ok) {
      // The text stays in the box: nothing is lost.
      toast.error(result.message ?? "Couldn't save that. Try again.", {
        action: { label: "Retry", onClick: () => void save() },
      });
      return;
    }
    setText("");
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        maxLength={INBOX_TEXT_MAX}
        rows={3}
        aria-label="Capture a thought"
        placeholder="Capture a thought, a link, a half-formed task…"
        className="block w-full resize-y rounded-md border border-input bg-background p-3 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-[14px]"
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="type-body-sm text-muted-foreground max-md:hidden">
          <Kbd>⌘↵</Kbd> to save
        </span>
        <Button onClick={() => void save()} disabled={saving || !text.trim()}>
          <Inbox strokeWidth={1.5} aria-hidden />
          Capture
        </Button>
      </div>
    </div>
  );
}
