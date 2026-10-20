"use client";

import { useEffect, useState } from "react";
import { CircleCheck, ListChecks, Search, X } from "lucide-react";
import { toast } from "sonner";
import { findTasksToLinkToCanvas, linkTaskCanvas, unlinkTaskCanvas } from "@/actions/canvases";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { CanvasTaskDTO } from "@/lib/canvas/dto";
import { formatPickerDay } from "@/lib/dates/calendar";
import { STATUS_LABELS, type TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

const trigger =
  "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-3 type-body-md text-foreground transition-colors duration-[120ms] hover:bg-accent md:h-8";

function Body({
  canvasId,
  tasks,
  onChange,
}: {
  canvasId: string;
  tasks: CanvasTaskDTO[];
  onChange: (tasks: CanvasTaskDTO[]) => void;
}) {
  const openTask = useOpenTask();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CanvasTaskDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await findTasksToLinkToCanvas({ query });
      if (!cancelled && result.ok) setHits(result.data);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const linked = new Set(tasks.map((t) => t.id));
  const candidates = hits.filter((h) => !linked.has(h.id));

  async function link(task: CanvasTaskDTO) {
    const result = await linkTaskCanvas({ taskId: task.id, canvasId });
    if (!result.ok) return void toast.error(result.error.message);
    onChange([...tasks, task].sort((a, b) => Number(a.isDone) - Number(b.isDone)));
    setQuery("");
  }

  async function unlink(task: CanvasTaskDTO) {
    const result = await unlinkTaskCanvas({ taskId: task.id, canvasId });
    if (!result.ok) return void toast.error(result.error.message);
    onChange(tasks.filter((t) => t.id !== task.id));
  }

  return (
    <div className="flex flex-col gap-3">
      {tasks.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">
          No tasks are linked to this canvas yet.
        </p>
      ) : (
        <ul aria-label="Linked tasks">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex min-h-11 items-center gap-1 border-b border-border last:border-b-0 md:min-h-9"
            >
              <button
                type="button"
                onClick={() => openTask(task.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent"
              >
                {task.isDone ? (
                  <CircleCheck
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "min-w-0 truncate type-body-md",
                    task.isDone && "text-muted-foreground line-through",
                  )}
                >
                  {task.emoji ? `${task.emoji} ` : ""}
                  {task.title}
                </span>
                <span className="ml-auto shrink-0 type-body-sm text-muted-foreground">
                  {STATUS_LABELS[task.status as TaskStatus] ?? task.status}
                  {task.dueDate ? ` · ${formatPickerDay(task.dueDate)}` : ""}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Unlink ${task.title}`}
                onClick={() => void unlink(task)}
                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
              >
                <X className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="type-body-sm text-muted-foreground">
        Deleting a card doesn&rsquo;t unlink its task, and unlinking doesn&rsquo;t delete the card.
      </p>
      <label className="relative block">
        <span className="sr-only">Link a task</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Link a task"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
        />
      </label>
      {candidates.length > 0 ? (
        <ul aria-label="Tasks to link" className="max-h-56 overflow-y-auto">
          {candidates.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => void link(task)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent md:min-h-9"
              >
                <span className="min-w-0 truncate">
                  {task.emoji ? `${task.emoji} ` : ""}
                  {task.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="type-body-sm text-muted-foreground">No open task matches.</p>
      ) : null}
    </div>
  );
}

/**
 * The Tasks button in the canvas header (V3 feature 01 §7): a count, and a panel (a popover on desktop, a bottom sheet
 * on a phone) listing the linked tasks, open ones first, with a search to link another and a control to unlink.
 * Linking is saved at once; it does not wait for the drawing to autosave.
 */
export function CanvasTasksButton({
  canvasId,
  tasks,
  onChange,
}: {
  canvasId: string;
  tasks: CanvasTaskDTO[];
  onChange: (tasks: CanvasTaskDTO[]) => void;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const label = (
    <>
      <ListChecks className="size-4" strokeWidth={1.5} aria-hidden />
      Tasks
      <span className="type-data-sm text-muted-foreground">
        <span className="sr-only"> linked: </span>
        {tasks.length}
      </span>
    </>
  );

  if (desktop) {
    return (
      <Popover>
        <PopoverTrigger className={trigger}>{label}</PopoverTrigger>
        <PopoverContent align="end" className="w-96">
          <p className="mb-2 type-headline-sm">Linked tasks</p>
          <Body canvasId={canvasId} tasks={tasks} onChange={onChange} />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet>
      <SheetTrigger className={trigger}>{label}</SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby="canvas-tasks-description"
        className="max-h-[85dvh] overflow-y-auto p-4"
      >
        <SheetTitle className="mb-1 type-headline-sm">Linked tasks</SheetTitle>
        <SheetDescription id="canvas-tasks-description" className="sr-only">
          Tasks linked to this canvas, and a search to link another.
        </SheetDescription>
        <Body canvasId={canvasId} tasks={tasks} onChange={onChange} />
      </SheetContent>
    </Sheet>
  );
}
