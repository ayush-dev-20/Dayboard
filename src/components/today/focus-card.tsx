"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { findFocusTasks, setFocus } from "@/actions/today";
import { CheckButton } from "@/components/ui/check-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { completeWithUndo } from "@/components/tasks/task-actions";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import { useOverride } from "@/hooks/use-override";
import type { TaskDTO } from "@/lib/tasks/dto";

type Candidate = { id: string; title: string; emoji: string | null; dueDate: string | null };

const link = "type-label-md text-muted-foreground hover:text-foreground";

/**
 * The one thing to focus on. Chosen by hand (an AI may suggest, never set). It clears itself once
 * the task is completed, cancelled or deleted.
 */
export function FocusCard({ focus }: { focus: TaskDTO | null }) {
  const router = useRouter();
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

  const picker = (label: string) => (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className={`${link} inline-flex h-11 items-center md:h-8`}>
        {label}
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
              className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8"
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
    <section aria-labelledby="focus-heading" className="rounded-lg bg-secondary px-6 py-5">
      <h2 id="focus-heading" className="type-label-caps text-muted-foreground">
        Focus
      </h2>
      {focus ? (
        <>
          <div className="mt-1 flex items-center gap-3">
            <CheckButton
              checked={done}
              onCheckedChange={(next) => {
                if (next)
                  void completeWithUndo({ id: focus.id, setDone, refresh: () => router.refresh() });
              }}
              label={done ? `Reopen ${focus.title}` : `Complete ${focus.title}`}
            />
            <Link
              href={`/tasks?task=${focus.id}`}
              className="min-w-0 flex-1 truncate type-headline-md text-foreground hover:underline"
            >
              {focus.emoji ? <span aria-hidden>{focus.emoji} </span> : null}
              {focus.title}
            </Link>
          </div>
          <div className="mt-2 flex items-center gap-5">
            {picker("Change focus")}
            <button
              type="button"
              onClick={() => void choose(null)}
              className={`${link} h-11 md:h-8`}
            >
              Clear
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 type-headline-md text-muted-foreground">Pick one thing to focus on.</p>
          <div className="mt-2">{picker("Choose a task")}</div>
        </>
      )}
    </section>
  );
}
