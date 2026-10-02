"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Link as LinkIcon, Search, X } from "lucide-react";
import { toast } from "sonner";
import { findTasksToLink, linkTaskNote, unlinkTaskNote } from "@/actions/notes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import type { LinkedTaskDTO } from "@/lib/notes/dto";
import { cn } from "@/lib/utils";

type Candidate = { id: string; title: string; emoji: string | null; dueDate: string | null };

const shortDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabel = (date: string) => shortDay.format(new Date(`${date}T00:00:00Z`));

type Props = {
  /** Null until the note exists (it is created on the first keystroke). */
  noteId: string | null;
  tasks: LinkedTaskDTO[];
  onChange: (tasks: LinkedTaskDTO[]) => void;
};

/** "Linked tasks": the tasks connected to this note (open first), and a search to link another. */
export function LinkedTasks({ noteId, tasks, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(text: string) {
    const result = await findTasksToLink({ query: text });
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

  async function link(task: Candidate) {
    if (!noteId) return;
    const result = await linkTaskNote({ taskId: task.id, noteId });
    if (!result.ok) {
      toast.error("Couldn't link that task. Try again.");
      return;
    }
    if (!tasks.some((t) => t.id === task.id)) {
      onChange(
        [...tasks, { ...task, isDone: false }].sort((a, b) => Number(a.isDone) - Number(b.isDone)),
      );
    }
    setQuery("");
  }

  async function unlink(task: LinkedTaskDTO) {
    if (!noteId) return;
    const result = await unlinkTaskNote({ taskId: task.id, noteId });
    if (!result.ok) {
      toast.error("Couldn't unlink that task. Try again.");
      return;
    }
    onChange(tasks.filter((t) => t.id !== task.id));
  }

  const linked = new Set(tasks.map((t) => t.id));
  const candidates = results.filter((t) => !linked.has(t.id));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="inline-flex h-11 items-center gap-2 rounded-md bg-secondary px-3 type-label-md text-foreground hover:bg-accent md:h-8"
        aria-label="Linked tasks"
      >
        <LinkIcon className="size-4" strokeWidth={1.5} aria-hidden />
        <span className="max-md:hidden">Linked tasks</span>
        {tasks.length > 0 ? (
          <span className="type-data-sm text-muted-foreground">{tasks.length}</span>
        ) : null}
        <ChevronDown
          className="size-4 text-muted-foreground max-md:hidden"
          strokeWidth={1.5}
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1" onKeyDown={handlePickerKeys}>
        <p className="px-2 pt-2 pb-1 type-label-caps text-muted-foreground">Linked tasks</p>
        {tasks.length === 0 ? (
          <p className="px-2 py-2 type-body-sm text-muted-foreground">No linked tasks yet.</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center">
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 hover:bg-accent md:min-h-8"
                >
                  <span
                    role="img"
                    aria-label={task.isDone ? "Done" : "Open"}
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border",
                      task.isDone
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input",
                    )}
                  >
                    {task.isDone ? (
                      <Check className="size-3" strokeWidth={2.5} aria-hidden />
                    ) : null}
                  </span>
                  {task.emoji ? <span aria-hidden>{task.emoji}</span> : null}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      task.isDone && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </span>
                  {task.dueDate ? (
                    <span className="rounded-sm bg-secondary px-1.5 type-data-sm text-muted-foreground">
                      {dayLabel(task.dueDate)}
                    </span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  aria-label={`Unlink ${task.title}`}
                  onClick={() => void unlink(task)}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
                >
                  <X className="size-3.5" strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1 border-t border-border pt-1">
          {noteId ? (
            <>
              <label className="relative block p-1">
                <span className="sr-only">Search your tasks</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  placeholder="Link a task"
                  autoComplete="off"
                  className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
                />
              </label>
              <div className="max-h-48 overflow-y-auto">
                {candidates.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    data-picker-item
                    onClick={() => void link(task)}
                    className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8"
                  >
                    {task.emoji ? <span aria-hidden>{task.emoji}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  </button>
                ))}
                {candidates.length === 0 ? (
                  <p className="px-2 py-2 type-body-sm text-muted-foreground">No tasks to link.</p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="px-2 py-2 type-body-sm text-muted-foreground">
              Start writing to create the note, then you can link tasks.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
