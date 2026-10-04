"use client";

import { CalendarCheck, Check } from "lucide-react";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { updateTask } from "@/actions/tasks";
import { setFocus } from "@/actions/today";
import { AiFailureNotice, AiLabel, StreamCaret } from "@/components/ai/ai-ui";
import { useAIEvents } from "@/components/ai/use-ai";
import { DueChip } from "@/components/tasks/due-chip";
import { useTaskContext } from "@/components/tasks/task-context";
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
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { PlanProposal, StreamEvent } from "@/lib/ai/types";
import { rowMotion, snappy } from "@/lib/motion";

type Data = { summary: string | null; items: PlanProposal[] };
const INITIAL: Data = { summary: null, items: [] };

function reduce(data: Data, event: StreamEvent): Data {
  if (event.type === "summary") return { ...data, summary: event.text || null };
  if (event.type === "proposal") return { ...data, items: [...data.items, event.item] };
  return data;
}

const plural = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

/**
 * Plan my day (feature 08 §6). A button on Today that opens a dialog streaming a shortlist of the
 * person's own tasks. Nothing changes until "Plan N tasks": then each ticked task that isn't due
 * today is moved to today, and the chosen Focus is set. Undo puts both back. It is a shortlist, not
 * a schedule: no times are set.
 */
export function PlanDay({ focusId }: { focusId: string | null }) {
  const { aiEnabled } = useWorkspace();
  const { state, run, retry, stop, reset } = useAIEvents("/api/ai/plan-day", INITIAL, reduce);
  const [open, setOpen] = useState(false);
  if (!aiEnabled) return null;

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          run({});
          setOpen(true);
        }}
      >
        <CalendarCheck strokeWidth={1.5} aria-hidden />
        Plan my day
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            stop();
            reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-[620px]" aria-describedby={undefined}>
          <PlanBody
            state={state}
            focusId={focusId}
            onRetry={retry}
            onClose={() => {
              setOpen(false);
              reset();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

type BodyProps = {
  state: ReturnType<typeof useAIEvents<Data>>["state"];
  focusId: string | null;
  onRetry: () => void;
  onClose: () => void;
};

function PlanBody({ state, focusId, onRetry, onClose }: BodyProps) {
  const router = useRouter();
  const { prefs, nowMs, today } = useTaskContext();
  const group = useId();
  // Rows fade and rise 4px as they arrive; with reduced motion they only fade.
  const reduceMotion = useReducedMotion();
  const arrive = reduceMotion
    ? {
        ...rowMotion,
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: rowMotion.animate.transition },
      }
    : rowMotion;
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const data = state.status === "idle" ? INITIAL : state.data;
  const generating = state.status === "generating";
  const items = data.items;
  const chosen = items.filter((i) => !skipped.has(i.taskId));
  // The first proposal is the default Focus; if that row is unticked, the next ticked one is.
  const focus = chosen.find((i) => i.taskId === picked) ?? chosen[0] ?? null;
  const empty = state.status === "complete" && items.length === 0;
  const failedEmpty = state.status === "failed" && items.length === 0;

  function toggle(id: string, on: boolean) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply(event?: React.FormEvent) {
    event?.preventDefault();
    if (applying || chosen.length === 0 || generating) return;
    setApplying(true);

    const moved: { id: string; previous: string | null }[] = [];
    let failed = 0;
    for (const item of chosen) {
      if (item.dueDate === today) continue;
      const result = await updateTask({ id: item.taskId, dueDate: today });
      if (result.ok) moved.push({ id: item.taskId, previous: item.dueDate });
      else failed += 1;
    }
    let focusSet = false;
    if (focus) focusSet = (await setFocus({ taskId: focus.taskId })).ok;

    setApplying(false);
    router.refresh();
    onClose();

    if (failed > 0) {
      toast.error(`${plural(failed)} couldn’t be updated.`);
    }
    if (moved.length === 0 && !focusSet) return;
    toast(`Planned ${plural(chosen.length)}.${focus && focusSet ? ` Focus: ${focus.title}` : ""}`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: async () => {
          let undoFailed = 0;
          for (const m of moved) {
            if (!(await updateTask({ id: m.id, dueDate: m.previous })).ok) undoFailed += 1;
          }
          if (focusSet && !(await setFocus({ taskId: focusId })).ok) undoFailed += 1;
          router.refresh();
          if (undoFailed > 0) toast.error("Couldn’t undo all of that. Check Today.");
        },
      },
    });
  }

  return (
    <form onSubmit={(e) => void apply(e)} noValidate>
      <DialogTitle>Plan my day</DialogTitle>

      {empty ? (
        <DialogDescription className="mt-2">
          Nothing needs planning. Your day is clear.
        </DialogDescription>
      ) : failedEmpty ? (
        <AiFailureNotice
          className="mt-4"
          error={state.error}
          text="Couldn’t make a plan. Nothing was changed."
          onRetry={onRetry}
          onDismiss={onClose}
        />
      ) : (
        <div aria-busy={generating}>
          <div className="mt-3">
            <AiLabel>{generating ? "Planning…" : "AI-generated"}</AiLabel>
          </div>
          {data.summary ? <p className="mt-2 type-body-md">{data.summary}</p> : null}
          <p role="status" className="sr-only">
            {generating ? "Planning" : "Plan ready"}
          </p>

          <ul className="mt-2 max-h-[50vh] overflow-y-auto" aria-label="Proposed plan">
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const on = !skipped.has(item.taskId);
                return (
                  <motion.li
                    key={item.taskId}
                    layout={reduceMotion ? false : "position"}
                    transition={snappy}
                    {...arrive}
                    className="flex flex-wrap items-start gap-x-1 border-b border-border py-2 last:border-b-0 sm:flex-nowrap"
                  >
                    <CheckButton
                      checked={on}
                      onCheckedChange={(checked) => toggle(item.taskId, checked)}
                      label={`Plan ${item.title}`}
                    />
                    <div className="min-w-0 flex-1 pt-2">
                      <p className="type-body-md">
                        {item.emoji ? <span aria-hidden>{item.emoji} </span> : null}
                        {item.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-body-sm text-muted-foreground">
                        {item.dueDate ? (
                          <DueChip
                            dueDate={item.dueDate}
                            dueTime={null}
                            status="PLANNED"
                            prefs={prefs}
                            nowMs={nowMs}
                          />
                        ) : null}
                        {item.reason}
                      </p>
                    </div>
                    <label className="ml-12 flex min-h-11 cursor-pointer items-center gap-2 type-body-sm sm:ml-0 md:min-h-9">
                      <input
                        type="radio"
                        name={`${group}-focus`}
                        aria-label={`Focus on ${item.title}`}
                        checked={focus?.taskId === item.taskId}
                        disabled={!on}
                        onChange={() => setPicked(item.taskId)}
                        className="size-4 accent-primary"
                      />
                      Focus
                    </label>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {generating ? (
            <p aria-hidden className="py-1">
              <StreamCaret />
            </p>
          ) : null}

          {state.status === "failed" ? (
            <AiFailureNotice
              className="mt-3"
              error={state.error}
              text="The plan stopped early."
              onRetry={onRetry}
            />
          ) : null}
          <p className="mt-3 type-body-sm text-muted-foreground">
            This is a shortlist, not a schedule. It doesn’t set times.
          </p>
        </div>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{empty || failedEmpty ? "Close" : "Cancel"}</Button>
        </DialogClose>
        {empty || failedEmpty ? null : (
          <Button type="submit" disabled={applying || generating || chosen.length === 0}>
            <Check strokeWidth={1.5} aria-hidden />
            {chosen.length === 0 ? "Plan tasks" : `Plan ${plural(chosen.length)}`}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
