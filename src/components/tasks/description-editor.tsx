"use client";

import { Check, CircleAlert } from "lucide-react";
import { updateTaskDescription } from "@/actions/tasks";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave";
import type { TiptapDoc } from "@/lib/editor/types";

/** Text only, never a toast: saving while typing is routine (DESIGN.md). */
export function SaveState({ status }: { status: SaveStatus }) {
  return (
    <p className="min-h-5 type-body-sm" aria-live="polite">
      {status === "saving" ? <span className="text-muted-foreground">Saving…</span> : null}
      {status === "saved" ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="size-3.5" strokeWidth={1.5} aria-hidden /> Saved
        </span>
      ) : null}
      {status === "failed" ? (
        <span className="inline-flex items-center gap-1 text-warning">
          <CircleAlert className="size-3.5" strokeWidth={1.5} aria-hidden /> Not saved, retrying
        </span>
      ) : null}
    </p>
  );
}

export function DescriptionEditor({
  taskId,
  initial,
  onLiveChange,
}: {
  taskId: string;
  initial: TiptapDoc | null;
  /** Every edit, as it happens, for anything that needs the current text (e.g. an AI rewrite). */
  onLiveChange?: (doc: TiptapDoc) => void;
}) {
  const { status, schedule, flush } = useAutosave<TiptapDoc>({
    save: async (doc) => (await updateTaskDescription({ id: taskId, descriptionJson: doc })).ok,
  });

  return (
    <section aria-labelledby="task-description-heading" className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 id="task-description-heading" className="type-label-caps text-muted-foreground">
          Description
        </h3>
        <SaveState status={status} />
      </div>
      <RichTextEditor
        initialContent={initial}
        onChange={(doc) => {
          onLiveChange?.(doc);
          schedule(doc);
        }}
        onBlur={flush}
        label="Task description"
        placeholder="Add details…"
      />
    </section>
  );
}
