"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dismissInboxSuggestion } from "@/actions/inbox";
import { createTasksBatch } from "@/actions/tasks";
import { AiFailureNotice, AiLabel } from "@/components/ai/ai-ui";
import { TasksPreviewDialog } from "@/components/ai/tasks-preview-dialog";
import { useAICall } from "@/components/ai/use-ai";
import { Button } from "@/components/ui/button";
import { useOverride } from "@/hooks/use-override";
import type { PreviewTask } from "@/lib/ai/tasks-output";
import type { InboxSuggestionType, StoredSuggestion } from "@/lib/ai/schemas";
import type { ConvertTarget } from "@/lib/inbox/convert";
import { ConvertDialog } from "./convert-dialog";

const TARGET_FOR: Record<InboxSuggestionType, ConvertTarget> = {
  TASK: "task",
  TODO: "todo",
  NOTE: "note",
  TASK_AND_NOTE: "task_note",
  PROJECT_IDEA: "project",
};

const LOOKS_LIKE: Record<InboxSuggestionType, string> = {
  TASK: "a task",
  TODO: "a todo",
  NOTE: "a note",
  TASK_AND_NOTE: "a task with a note",
  PROJECT_IDEA: "a project idea",
};

const CREATE_LABEL: Record<InboxSuggestionType, string> = {
  TASK: "Create task",
  TODO: "Create todo",
  NOTE: "Create note",
  TASK_AND_NOTE: "Create task and note",
  PROJECT_IDEA: "Create project idea",
};

/**
 * The AI row of an inbox item: "Suggest" (what is this?) and "Turn into tasks" (what actions are
 * in it?). Both only propose. The suggestion chip opens the Convert dialog pre-filled, and the
 * task list is a preview; the person confirms in both.
 */
export function InboxAi({
  item,
}: {
  item: { id: string; text: string; aiSuggestion: StoredSuggestion | null };
}) {
  const router = useRouter();
  const classify = useAICall<{ suggestion: StoredSuggestion | null }>("/api/ai/classify-inbox");
  const extract = useAICall<{ items: PreviewTask[] }>("/api/ai/extract-tasks");
  const [stored, setStored] = useOverride<StoredSuggestion | false>(item.aiSuggestion ?? false);
  const [converting, setConverting] = useState<StoredSuggestion | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);

  const fresh = classify.state.status === "complete" ? classify.state.data.suggestion : null;
  const suggestion = fresh ?? (stored || null);

  async function dismiss() {
    classify.reset();
    setStored(false);
    const result = await dismissInboxSuggestion({ id: item.id });
    if (!result.ok) toast.error("Couldn’t dismiss that. Try again.");
  }

  async function createTasks(chosen: { title: string; dueDate: string | null }[]) {
    const result = await createTasksBatch({ items: chosen, fromInboxItemId: item.id });
    if (!result.ok) return result.error.message;
    setExtractOpen(false);
    toast(`Created ${chosen.length} ${chosen.length === 1 ? "task" : "tasks"}.`, {
      action: { label: "Open", onClick: () => router.push("/tasks") },
    });
    return null;
  }

  return (
    <div className="mt-2">
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <AiLabel />
          <span className="type-body-md">
            Looks like {LOOKS_LIKE[suggestion.type]}: “{suggestion.title}”
          </span>
          <Button variant="secondary" onClick={() => setConverting(suggestion)}>
            {CREATE_LABEL[suggestion.type]}
          </Button>
          <Button variant="secondary" onClick={() => void dismiss()}>
            Dismiss
          </Button>
        </div>
      ) : classify.state.status === "generating" ? (
        <p role="status" className="type-label-caps text-muted-foreground">
          Generating
        </p>
      ) : classify.state.status === "failed" ? (
        <AiFailureNotice
          error={classify.state.error}
          text="Couldn’t suggest what this is. Nothing was changed."
          onRetry={classify.retry}
          onDismiss={classify.reset}
        />
      ) : classify.state.status === "complete" ? (
        <p className="type-body-sm text-muted-foreground">No clear suggestion for this one.</p>
      ) : (
        <div className="-ml-3 flex items-center gap-1">
          <Button variant="ghost" onClick={() => classify.run({ inboxItemId: item.id })}>
            Suggest
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              extract.run({ inboxItemId: item.id });
              setExtractOpen(true);
            }}
          >
            Turn into tasks
          </Button>
        </div>
      )}

      {suggestion && classify.state.status !== "generating" ? (
        <div className="mt-1 -ml-3">
          <Button
            variant="ghost"
            onClick={() => {
              extract.run({ inboxItemId: item.id });
              setExtractOpen(true);
            }}
          >
            Turn into tasks
          </Button>
        </div>
      ) : null}

      {converting ? (
        <ConvertDialog
          item={item}
          initialTarget={TARGET_FOR[converting.type]}
          initialTitle={converting.title}
          open
          onOpenChange={(open) => !open && setConverting(null)}
        />
      ) : null}

      <TasksPreviewDialog
        open={extractOpen}
        onOpenChange={(open) => {
          setExtractOpen(open);
          if (!open) extract.reset();
        }}
        title="Turn into tasks"
        intro="Untick anything you don’t want. Nothing is created until you confirm."
        progress="Reading your text…"
        state={extract.state}
        onRetry={extract.retry}
        confirmLabel={(n) => `Create ${n} ${n === 1 ? "task" : "tasks"}`}
        failureText="Couldn’t find tasks in this. Nothing was changed."
        emptyText="No tasks found in this text."
        onConfirm={createTasks}
      />
    </div>
  );
}
