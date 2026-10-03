"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, SignalHigh } from "lucide-react";
import { toast } from "sonner";
import { updateTask } from "@/actions/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { nextMondayOf, tomorrowOf } from "@/lib/dates/today";
import type { TaskDTO } from "@/lib/tasks/dto";
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { PriorityGlyph } from "./priority-glyph";
import { useTaskContext } from "./task-context";

const trigger = cn(
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150",
  "hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground",
);

/**
 * Due date and priority, one click from the row (feature 07 §7.2). Revealed on row hover and on
 * keyboard focus, always shown on touch-only screens; on phones the overflow menu is the way in.
 * They fade rather than appear, so nothing in the row moves.
 */
export function TaskQuickActions({ task }: { task: TaskDTO }) {
  const router = useRouter();
  const { prefs, nowMs, today } = useTaskContext();
  const now = new Date(nowMs);

  async function save(patch: { dueDate?: string | null; priority?: TaskPriority }) {
    const result = await updateTask({ id: task.id, ...patch });
    if (!result.ok) {
      toast.error(Object.values(result.error.fieldErrors ?? {})[0] ?? result.error.message);
      return;
    }
    router.refresh();
  }

  const dates = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: tomorrowOf(prefs, now) },
    { label: "Next Monday", date: nextMondayOf(prefs, now) },
  ];

  return (
    <div
      className={cn(
        "hidden shrink-0 items-center md:flex",
        "md:opacity-0 md:transition-opacity md:duration-150 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:has-data-[state=open]:opacity-100",
        "[@media(hover:none)]:opacity-100",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Change due date for ${task.title}`} className={trigger}>
          <CalendarDays className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {dates.map((d) => (
            <DropdownMenuItem key={d.label} onSelect={() => void save({ dueDate: d.date })}>
              {d.label}
            </DropdownMenuItem>
          ))}
          {task.dueDate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={Boolean(task.recurrenceRule)}
                title={task.recurrenceRule ? "A repeating task needs a due date." : undefined}
                onSelect={() => void save({ dueDate: null })}
              >
                No date
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Change priority for ${task.title}`} className={trigger}>
          <SignalHigh className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={task.priority}
            onValueChange={(v) => void save({ priority: v as TaskPriority })}
          >
            {TASK_PRIORITIES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
                <span className="ml-auto">
                  <PriorityGlyph priority={p} />
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
