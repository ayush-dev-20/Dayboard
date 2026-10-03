"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { toast } from "sonner";
import { findFocusTasks, setFocus } from "@/actions/today";
import { CheckButton } from "@/components/ui/check-button";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DueChip } from "@/components/tasks/due-chip";
import { completeWithUndo } from "@/components/tasks/task-actions";
import { useTaskContext } from "@/components/tasks/task-context";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import { ProjectToken } from "@/components/workspace/tokens";
import { useOverride } from "@/hooks/use-override";
import type { TaskDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";

type Candidate = { id: string; title: string; emoji: string | null; dueDate: string | null };

const quiet =
  "inline-flex h-11 cursor-pointer items-center rounded-md px-2 type-label-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:h-8";

/**
 * The one big card on Today (DESIGN.md: focus-hero). Empty, it suggests up to three tasks from the
 * lists Today already loaded. Set, it shows the task with its due date, project and subtask
 * progress, and Open / Change / Clear. The person chooses; an AI never sets the focus. It clears
 * itself once the task is completed, cancelled or deleted.
 */
export function FocusHero({
  focus,
  suggestions,
}: {
  focus: TaskDTO | null;
  suggestions: TaskDTO[];
}) {
  const router = useRouter();
  const { prefs, nowMs } = useTaskContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [done, setDone] = useOverride(focus?.status === "DONE");

  async function search(text: string) {
    const result = await findFocusTasks({ query: text });
    if (result.ok) setResults(result.data);
  }

  function onQuery(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 200);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      void search("");
    }
  }

  async function choose(taskId: string | null) {
    setOpen(false);
    const result = await setFocus({ taskId });
    if (!result.ok) toast.error("Couldn't change your focus. Try again.");
  }

  const picker = (label: string, visible: string, className?: string) => (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger aria-label={label} className={cn(quiet, className)}>
        {visible}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1" onKeyDown={handlePickerKeys}>
        <label className="relative block p-1">
          <span className="sr-only">Search your open tasks</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Find a task"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
          />
        </label>
        <div className="max-h-64 overflow-y-auto">
          {results.map((task) => (
            <button
              key={task.id}
              type="button"
              data-picker-item
              onClick={() => void choose(task.id)}
              className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8"
            >
              {task.emoji ? <span aria-hidden>{task.emoji}</span> : null}
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
            </button>
          ))}
          {results.length === 0 ? (
            <p className="px-2 py-3 type-body-sm text-muted-foreground">No open tasks to choose.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <section
      aria-labelledby="focus-heading"
      className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xs md:p-6"
    >
      {/* The one soft single-hue wash allowed in the app (DESIGN.md: Do's and Don'ts). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,var(--landing-wash)_0%,transparent_60%)] opacity-70"
      />
      <div className="relative">
        <h2 id="focus-heading" className="type-label-caps text-muted-foreground">
          Focus
        </h2>
        {focus ? (
          <>
            <div className="mt-2 flex items-start gap-2">
              <CheckButton
                checked={done}
                onCheckedChange={(next) => {
                  if (next)
                    void completeWithUndo({
                      id: focus.id,
                      setDone,
                      refresh: () => router.refresh(),
                    });
                }}
                label={done ? `Reopen ${focus.title}` : `Complete ${focus.title}`}
                className="-ml-2.5"
              />
              <Link
                href={`/tasks?task=${focus.id}`}
                className={cn(
                  "min-w-0 flex-1 pt-1.5 type-headline-md text-foreground hover:underline md:pt-1",
                  done && "text-muted-foreground line-through",
                )}
              >
                {focus.emoji ? <span aria-hidden>{focus.emoji} </span> : null}
                {focus.title}
              </Link>
            </div>
            {focus.dueDate || focus.project || focus.subtaskTotal > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 pl-9">
                {focus.dueDate ? (
                  <DueChip
                    dueDate={focus.dueDate}
                    dueTime={focus.dueTime}
                    status={done ? "DONE" : focus.status}
                    prefs={prefs}
                    nowMs={nowMs}
                  />
                ) : null}
                {focus.project ? <ProjectToken project={focus.project} /> : null}
                {focus.subtaskTotal > 0 ? (
                  <span className="flex items-center gap-2 type-data-sm text-muted-foreground">
                    <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(focus.subtaskDone / focus.subtaskTotal) * 100}%` }}
                      />
                    </span>
                    <span>
                      <span className="sr-only">Subtasks done: </span>
                      {focus.subtaskDone}/{focus.subtaskTotal}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-1 pl-7">
              <Link
                href={`/tasks?task=${focus.id}`}
                className={cn(buttonVariants({ variant: "secondary" }), "cursor-pointer")}
              >
                Open <ArrowUpRight strokeWidth={1.5} aria-hidden />
              </Link>
              {picker("Change focus", "Change")}
              <button type="button" onClick={() => void choose(null)} className={quiet}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 type-headline-md text-foreground">Pick your focus</p>
            <p className="mt-1 type-body-md text-muted-foreground">
              Pick one thing to focus on.
              {suggestions.length > 0 ? " A few from your list:" : ""}
            </p>
            {suggestions.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Suggested focus">
                {suggestions.map((task) => (
                  <li key={task.id} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => void choose(task.id)}
                      aria-label={`Focus on ${task.title}`}
                      className="inline-flex h-11 max-w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 type-body-md text-foreground transition-colors duration-150 hover:border-border-strong hover:bg-accent md:h-8"
                    >
                      {task.emoji ? <span aria-hidden>{task.emoji}</span> : null}
                      <span className="truncate">{task.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 -ml-2">{picker("Choose a task", "Choose a task")}</div>
          </>
        )}
      </div>
    </section>
  );
}
