"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createTasksBatch } from "@/actions/tasks";
import { AiFailureNotice, AiGenerating, AiLabel, AiPanel } from "@/components/ai/ai-ui";
import { useAICall } from "@/components/ai/use-ai";
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
import type { TaskAssistMode } from "@/lib/ai/types";
import type { TaskDTO } from "@/lib/tasks/dto";

type Props = {
  task: TaskDTO;
  /** The description as it is in the editor right now, to show beside a proposed rewrite. */
  getDescriptionText: () => string;
  /** New subtasks, so the Subtasks list shows them straight away. */
  onSubtasksAdded: (created: TaskDTO[]) => void;
  /** Saves a rewrite. Returns an error message, or null when it worked. */
  onReplace: (next: { title: string | null; description: string }) => Promise<string | null>;
};

type RewriteData = { mode: TaskAssistMode; title: string | null; description: string };
type EstimateData = { mode: "ESTIMATE"; estimate: string; rationale: string };
type StepsData = { mode: "NEXT_STEPS"; steps: string[] };

/**
 * The AI part of the task detail panel: five buttons, and what each one proposes. Every result is
 * a proposal. Subtasks and rewrites change the task only on the person's confirm click; an
 * estimate is shown and never saved.
 */
export function TaskAi({ task, getDescriptionText, onSubtasksAdded, onReplace }: Props) {
  const subtasks = useAICall<{ subtasks: { title: string }[] }>("/api/ai/subtasks");
  const rewrite = useAICall<RewriteData>("/api/ai/task-assist");
  const estimate = useAICall<EstimateData>("/api/ai/task-assist");
  const next = useAICall<StepsData>("/api/ai/task-assist");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const isSubtask = Boolean(task.parentTaskId);

  const busy = [subtasks, rewrite, estimate, next].some((c) => c.state.status === "generating");

  return (
    <section aria-labelledby="task-ai-heading" className="mt-6">
      <div className="flex flex-col gap-3 empty:hidden">
        {subtasks.state.status === "generating" ? (
          <AiPanel>
            <AiGenerating />
          </AiPanel>
        ) : null}
        {subtasks.state.status === "failed" ? (
          <AiFailureNotice
            error={subtasks.state.error}
            text="Couldn’t suggest subtasks. Nothing was changed."
            onRetry={subtasks.retry}
            onDismiss={subtasks.reset}
          />
        ) : null}
        {subtasks.state.status === "complete" ? (
          <SubtasksPreview
            key={subtasks.state.data.subtasks.map((s) => s.title).join("|")}
            taskId={task.id}
            titles={subtasks.state.data.subtasks.map((s) => s.title)}
            onAdded={(created) => {
              onSubtasksAdded(created);
              subtasks.reset();
            }}
            onDiscard={subtasks.reset}
          />
        ) : null}

        {rewrite.state.status === "failed" ? (
          <AiFailureNotice
            error={rewrite.state.error}
            text="Couldn’t rewrite this. Nothing was changed."
            onRetry={rewrite.retry}
            onDismiss={rewrite.reset}
          />
        ) : null}

        {estimate.state.status === "generating" || next.state.status === "generating" ? (
          <AiPanel>
            <AiGenerating />
          </AiPanel>
        ) : null}
        {estimate.state.status === "failed" ? (
          <AiFailureNotice
            error={estimate.state.error}
            text="Couldn’t estimate this. Nothing was changed."
            onRetry={estimate.retry}
            onDismiss={estimate.reset}
          />
        ) : null}
        {next.state.status === "failed" ? (
          <AiFailureNotice
            error={next.state.error}
            text="Couldn’t suggest next steps. Nothing was changed."
            onRetry={next.retry}
            onDismiss={next.reset}
          />
        ) : null}
        {estimate.state.status === "complete" ? (
          <AiPanel aria-label="Estimate">
            <AiLabel />
            <p className="mt-2 flex flex-wrap items-baseline gap-x-3">
              <span className="type-headline-sm">{estimate.state.data.estimate}</span>
              <span className="type-body-sm text-muted-foreground">
                Estimate, shown only. Not saved.
              </span>
            </p>
            <p className="mt-2 type-body-md">{estimate.state.data.rationale}</p>
            <button
              type="button"
              onClick={estimate.reset}
              className="mt-3 type-body-md text-primary underline"
            >
              Dismiss
            </button>
          </AiPanel>
        ) : null}
        {next.state.status === "complete" ? (
          <NextSteps
            taskId={task.id}
            steps={next.state.data.steps}
            canAdd={!isSubtask}
            onAdded={onSubtasksAdded}
            onDismiss={next.reset}
          />
        ) : null}
      </div>

      <h3 id="task-ai-heading" className="mt-6 mb-2 type-label-caps text-muted-foreground">
        AI actions
      </h3>
      <div className="flex flex-wrap gap-2">
        {isSubtask ? null : (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => subtasks.run({ taskId: task.id })}
          >
            Break into subtasks
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            rewrite.run({ taskId: task.id, mode: "REWRITE_DESCRIPTION" });
            setCurrent(getDescriptionText());
            setRewriteOpen(true);
          }}
        >
          Rewrite description
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            rewrite.run({ taskId: task.id, mode: "CLARIFY" });
            setCurrent(getDescriptionText());
            setRewriteOpen(true);
          }}
        >
          Clarify
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => estimate.run({ taskId: task.id, mode: "ESTIMATE" })}
        >
          Estimate
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => next.run({ taskId: task.id, mode: "NEXT_STEPS" })}
        >
          Suggest next steps
        </Button>
      </div>

      <RewriteDialog
        open={rewriteOpen && rewrite.state.status !== "idle" && rewrite.state.status !== "failed"}
        onOpenChange={(open) => {
          setRewriteOpen(open);
          if (!open) rewrite.reset();
        }}
        task={task}
        current={current}
        state={rewrite.state}
        onReplace={async (value) => {
          const message = await onReplace(value);
          if (!message) {
            setRewriteOpen(false);
            rewrite.reset();
          }
          return message;
        }}
      />
    </section>
  );
}

function SubtasksPreview({
  taskId,
  titles,
  onAdded,
  onDiscard,
}: {
  taskId: string;
  titles: string[];
  onAdded: (created: TaskDTO[]) => void;
  onDiscard: () => void;
}) {
  const [ticked, setTicked] = useState<boolean[]>(() => titles.map(() => true));
  const [pending, setPending] = useState(false);
  const chosen = titles.filter((_, i) => ticked[i]);

  async function add() {
    setPending(true);
    const result = await createTasksBatch({
      items: chosen.map((title) => ({ title })),
      parentTaskId: taskId,
    });
    setPending(false);
    if (!result.ok) return void toast.error(result.error.message);
    onAdded(result.data);
  }

  return (
    <AiPanel aria-label="Suggested subtasks">
      <AiLabel />
      <h4 className="mt-2 type-label-md font-semibold">Suggested subtasks</h4>
      <ul className="mt-2">
        {titles.map((title, i) => (
          <li key={title} className="flex items-center">
            <CheckButton
              checked={ticked[i] ?? false}
              onCheckedChange={(checked) =>
                setTicked((list) => list.map((v, j) => (j === i ? checked : v)))
              }
              label={`Add ${title}`}
              className="-ml-2.5"
            />
            <span className="type-body-md">{title}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={pending || chosen.length === 0} onClick={() => void add()}>
          {chosen.length === 0
            ? "Add subtasks"
            : `Add ${chosen.length} ${chosen.length === 1 ? "subtask" : "subtasks"}`}
        </Button>
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </AiPanel>
  );
}

function NextSteps({
  taskId,
  steps,
  canAdd,
  onAdded,
  onDismiss,
}: {
  taskId: string;
  steps: string[];
  canAdd: boolean;
  onAdded: (created: TaskDTO[]) => void;
  onDismiss: () => void;
}) {
  const [added, setAdded] = useState<string[]>([]);

  async function make(title: string) {
    const result = await createTasksBatch({ items: [{ title }], parentTaskId: taskId });
    if (!result.ok) return void toast.error(result.error.message);
    setAdded((list) => [...list, title]);
    onAdded(result.data);
  }

  return (
    <AiPanel aria-label="Next steps">
      <AiLabel />
      <h4 className="mt-2 type-label-md font-semibold">Next steps</h4>
      <ul className="mt-2">
        {steps.map((step) => (
          <li key={step} className="flex items-center justify-between gap-3 py-1">
            <span className="type-body-md">{step}</span>
            {canAdd ? (
              added.includes(step) ? (
                <span className="shrink-0 type-body-sm text-muted-foreground">Added</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void make(step)}
                  aria-label={`Make subtask: ${step}`}
                  className="shrink-0 type-body-sm text-primary underline"
                >
                  Make subtask
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 type-body-md text-primary underline"
      >
        Dismiss
      </button>
    </AiPanel>
  );
}

function RewriteDialog({
  open,
  onOpenChange,
  task,
  current,
  state,
  onReplace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskDTO;
  current: string;
  state: ReturnType<typeof useAICall<RewriteData>>["state"];
  onReplace: (next: { title: string | null; description: string }) => Promise<string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = state.status === "complete" ? state.data.mode : null;

  async function replace() {
    if (state.status !== "complete") return;
    setPending(true);
    setError(null);
    const message = await onReplace({
      title: state.data.title && state.data.title !== task.title ? state.data.title : null,
      description: state.data.description,
    });
    setPending(false);
    if (message) setError(message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogTitle>{mode === "CLARIFY" ? "Clarify task" : "Rewrite description"}</DialogTitle>
        <DialogDescription className="sr-only">
          Compare the current description with the proposed one, then replace or discard.
        </DialogDescription>
        {state.status === "generating" ? (
          <div className="mt-4">
            <AiGenerating />
          </div>
        ) : null}
        {state.status === "complete" ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="type-label-caps text-muted-foreground">Current</p>
              <p className="mt-2 type-body-md whitespace-pre-wrap">
                {current || "No description yet."}
              </p>
            </div>
            <AiPanel>
              <AiLabel />
              {state.data.title && state.data.title !== task.title ? (
                <p className="mt-2 type-body-md font-semibold">{state.data.title}</p>
              ) : null}
              <p className="mt-2 type-body-md whitespace-pre-wrap">{state.data.description}</p>
            </AiPanel>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 type-body-md text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Discard</Button>
          </DialogClose>
          <Button disabled={state.status !== "complete" || pending} onClick={() => void replace()}>
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
