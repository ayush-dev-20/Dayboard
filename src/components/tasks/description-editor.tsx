"use client";

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, CircleAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { updateTaskDescription } from "@/actions/tasks";
import { GeneratePanel, type GenerateResult } from "@/components/ai/generate-panel";
import { appendDoc, replaceAll, type ApplyResult } from "@/components/editor/ai-apply";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
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
  const { aiEnabled } = useWorkspace();
  const [generateOpen, setGenerateOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  // Generate with AI (feature 08): the draft goes in through editor transactions, so one Undo
  // restores the description and autosave sees an ordinary edit. The task title is never touched.
  async function applyGenerated(result: GenerateResult): Promise<ApplyResult> {
    const editor = editorRef.current;
    if (!editor)
      return { ok: false, reason: "The description changed. Regenerate or copy the text." };
    const applied =
      result.placement === "replace"
        ? replaceAll(editor, result.doc)
        : appendDoc(editor, result.doc);
    if (!applied.ok) return applied;
    void flush();
    if (result.placement === "replace") {
      toast("Description replaced.", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            editorRef.current?.chain().focus().undo().run();
            void flush();
          },
        },
      });
    }
    return applied;
  }

  return (
    <section aria-labelledby="task-description-heading" className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id="task-description-heading" className="type-label-caps text-muted-foreground">
          Description
        </h3>
        <div className="flex items-center gap-3">
          {aiEnabled && !generateOpen ? (
            <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
              <Sparkles strokeWidth={1.5} aria-hidden />
              Generate with AI
            </Button>
          ) : null}
          <SaveState status={status} />
        </div>
      </div>
      {aiEnabled && generateOpen ? (
        <GeneratePanel
          target={{ kind: "task", id: taskId }}
          hasContext
          title="none"
          variant="compact"
          autoFocus
          beforeGenerate={flush}
          onApply={applyGenerated}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}
      <RichTextEditor
        initialContent={initial}
        onChange={(doc) => {
          onLiveChange?.(doc);
          schedule(doc);
        }}
        onBlur={flush}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
        onEditorDestroy={() => {
          editorRef.current = null;
        }}
        surface="task"
        ownerId={taskId}
        // Ask AI and Update with AI on selected text, like in notes (feature 11 §6B).
        writingHelp={aiEnabled}
        label="Task description"
        placeholder="Add details…"
      />
    </section>
  );
}
