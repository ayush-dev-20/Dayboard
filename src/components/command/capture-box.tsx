"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { saveToInbox } from "./capture";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { INBOX_TEXT_MAX } from "@/lib/validations/inbox";

/**
 * One textarea and Save. Cmd/Ctrl+Enter saves, Esc closes. A failed save keeps every word and
 * offers Retry. Used inside the command menu; the same save function is used on Today and Inbox.
 */
export function CaptureBox({
  initialText = "",
  onDone,
  onClose,
}: {
  initialText?: string;
  /** Called after the item is saved. */
  onDone: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    setFailed(false);
    const result = await saveToInbox(value);
    setSaving(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    toast("Saved to Inbox.");
    onDone();
  }

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="type-label-md text-foreground">Quick capture</h2>
        <span className="type-body-sm text-muted-foreground">To Inbox</span>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        maxLength={INBOX_TEXT_MAX}
        rows={4}
        aria-label="What do you want to capture?"
        placeholder="What do you want to capture?"
        className="block w-full resize-none rounded-md border border-input bg-background p-3 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-[14px]"
      />
      {failed ? (
        <div
          role="alert"
          className="mt-3 flex items-center gap-3 rounded-md bg-destructive-subtle p-3 type-body-md text-destructive"
        >
          <CircleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <p className="flex-1">Could not save. Your text is still here.</p>
          <button
            type="button"
            onClick={() => void save()}
            className="type-label-md underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 type-body-sm text-muted-foreground hover:text-foreground"
        >
          <Kbd>Esc</Kbd> close
        </button>
        <Button onClick={() => void save()} disabled={saving || !text.trim()}>
          Save{" "}
          <span className="max-md:hidden">
            <Kbd className="bg-primary-strong text-primary-foreground">⌘↵</Kbd>
          </span>
        </Button>
      </div>
    </div>
  );
}
