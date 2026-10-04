"use client";

import { ListPlus } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckButton } from "@/components/ui/check-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PreviewTask } from "@/lib/ai/tasks-output";
import { AiFailureNotice, AiGenerating, AiLabel, DueDateChip } from "./ai-ui";
import type { AIState } from "./use-ai";

export type ChosenTask = { title: string; dueDate: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Shown above the list once there is one. */
  intro: string;
  /** Shown while generating, e.g. "Reading your text…". */
  progress: string;
  state: AIState<{ items: PreviewTask[] }>;
  onRetry: () => void;
  /** "Create 3 tasks" or "Create 3 tasks and link". */
  confirmLabel: (count: number) => string;
  failureText: string;
  emptyText: string;
  /** Creates the chosen tasks. Returns an error message to show, or null when it worked. */
  onConfirm: (chosen: ChosenTask[]) => Promise<string | null>;
};

/**
 * Turns AI-found tasks into a checklist the person edits and confirms (feature doc §5). Every item
 * is ticked, its title and date are editable, and nothing exists until the confirm button runs.
 */
export function TasksPreviewDialog({
  open,
  onOpenChange,
  title,
  intro,
  progress,
  state,
  onRetry,
  confirmLabel,
  failureText,
  emptyText,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogTitle>{title}</DialogTitle>
        {state.status === "complete" && state.data.items.length > 0 ? (
          <PreviewList
            // A new answer (after Retry) starts a fresh checklist.
            items={state.data.items}
            intro={intro}
            confirmLabel={confirmLabel}
            onConfirm={onConfirm}
          />
        ) : (
          <>
            <DialogDescription>
              {state.status === "complete" ? emptyText : progress}
            </DialogDescription>
            {state.status === "failed" ? (
              <AiFailureNotice
                className="mt-4"
                error={state.error}
                text={failureText}
                onRetry={onRetry}
                onDismiss={() => onOpenChange(false)}
              />
            ) : state.status === "generating" ? (
              <div className="mt-4">
                <AiGenerating />
              </div>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">
                  {state.status === "complete" ? "Close" : "Cancel"}
                </Button>
              </DialogClose>
              {state.status === "generating" ? <Button disabled>Create tasks</Button> : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Row = { title: string; dueDate: string | null; hint: string | null; checked: boolean };

function hintOf(task: PreviewTask): string | null {
  if (task.owner) return `Owner named: ${task.owner}`;
  return task.evidence;
}

function PreviewList({
  items,
  intro,
  confirmLabel,
  onConfirm,
}: {
  items: PreviewTask[];
  intro: string;
  confirmLabel: (count: number) => string;
  onConfirm: (chosen: ChosenTask[]) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((t) => ({ title: t.title, dueDate: t.dueDate, hint: hintOf(t), checked: true })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = rows.filter((r) => r.checked);
  const blank = chosen.some((r) => r.title.trim() === "");

  function update(index: number, patch: Partial<Row>) {
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const allChecked = chosen.length === rows.length;

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || chosen.length === 0 || blank) return;
    setPending(true);
    setError(null);
    const message = await onConfirm(
      chosen.map((r) => ({ title: r.title.trim(), dueDate: r.dueDate })),
    );
    // On success the parent closes the dialog; only a failure leaves it here.
    if (message) {
      setError(message);
      setPending(false);
    }
  }

  return (
    // A form, so Enter in any title confirms (Esc closes the dialog and discards everything).
    <form onSubmit={(e) => void submit(e)} noValidate>
      <DialogDescription>{intro}</DialogDescription>
      {error ? <Alert className="mt-3">{error}</Alert> : null}
      <div className="mt-4 ai-panel px-3 pt-3 pb-1">
        <div className="flex items-center justify-between gap-3">
          <AiLabel />
          <p className="flex items-center gap-3 type-body-sm text-muted-foreground">
            <span aria-live="polite">
              {chosen.length} of {rows.length} selected
            </span>
            <Button
              variant="secondary"
              onClick={() => setRows((list) => list.map((r) => ({ ...r, checked: !allChecked })))}
            >
              {allChecked ? "Select none" : "Select all"}
            </Button>
          </p>
        </div>
        <ul className="mt-1 max-h-[50vh] overflow-y-auto" aria-label="Tasks found">
          {rows.map((row, i) => (
            <li
              key={i}
              className={cn(
                "flex flex-wrap items-start gap-x-1 gap-y-1 border-b border-ai-border py-2 transition-opacity duration-150 last:border-b-0 sm:flex-nowrap",
                !row.checked && "opacity-60",
              )}
            >
              <CheckButton
                checked={row.checked}
                onCheckedChange={(checked) => update(i, { checked })}
                label={`Include ${row.title || "this task"}`}
              />
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Task title ${i + 1}`}
                  value={row.title}
                  maxLength={500}
                  disabled={!row.checked}
                  onChange={(e) => update(i, { title: e.target.value })}
                  aria-invalid={row.checked && row.title.trim() === "" ? true : undefined}
                />
                {row.hint ? (
                  <p className="mt-1 px-3 type-body-sm text-muted-foreground">{row.hint}</p>
                ) : null}
              </div>
              <div className="ml-12 sm:ml-0">
                <DueDateChip
                  value={row.dueDate}
                  onChange={(dueDate) => update(i, { dueDate })}
                  label={`Due date for ${row.title || "this task"}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={pending || chosen.length === 0 || blank}>
          <ListPlus strokeWidth={1.5} aria-hidden />
          {chosen.length === 0 ? "Create tasks" : confirmLabel(chosen.length)}
        </Button>
      </DialogFooter>
    </form>
  );
}
