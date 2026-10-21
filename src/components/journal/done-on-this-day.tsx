"use client";

import { useId, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { TodoEditDialog } from "@/components/tasks/todo-edit-dialog";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/workspace/tokens";
import { doneTime } from "@/lib/dates/journal";
import type { DoneItem, DoneOnDay } from "@/lib/journal/dto";
import type { TodoDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";

// "Done on this day" (V3 feature 02 §5): a record of what was completed that day, worked out when the page opens and
// never stored in the note. It has no completion controls. A task opens in its side panel and a todo in its edit
// dialog, both in place. "Add to entry" copies the list into the note as text.

function asTodo(item: DoneItem): TodoDTO {
  return {
    id: item.id,
    title: item.title,
    emoji: item.emoji,
    isComplete: true,
    completedAt: item.completedAt,
    dueDate: item.dueDate,
    sortOrder: 0,
    archived: false,
    createdAt: item.completedAt,
    updatedAt: item.completedAt,
    project: item.project,
  };
}

function Row({
  item,
  timeZone,
  onOpen,
}: {
  item: DoneItem;
  timeZone: string;
  onOpen: (item: DoneItem) => void;
}) {
  return (
    <li className="flex min-h-11 items-center gap-2 border-b border-border py-1.5 md:min-h-9">
      <Check className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="min-w-0 flex-1 cursor-pointer truncate text-left type-body-md text-foreground hover:underline focus-visible:underline"
      >
        {item.emoji ? <span aria-hidden>{item.emoji} </span> : null}
        {item.title || "Untitled"}
        {item.parentTitle ? (
          <span className="ml-2 type-body-sm text-muted-foreground">in {item.parentTitle}</span>
        ) : null}
        {item.canvas ? (
          <span className="ml-2 type-body-sm text-muted-foreground">
            Sticky note{item.canvas.title ? ` on ${item.canvas.title}` : ""}
          </span>
        ) : null}
      </button>
      {item.project ? (
        <span className="inline-flex max-w-32 shrink-0 items-center gap-1.5 type-body-sm text-muted-foreground max-sm:hidden">
          <ColorDot color={item.project.color} />
          <span className="truncate">{item.project.name}</span>
        </span>
      ) : null}
      <time
        dateTime={item.completedAt}
        className="shrink-0 type-data-sm text-muted-foreground tabular-nums"
      >
        <span className="sr-only">Done at </span>
        {doneTime(item.completedAt, timeZone)}
      </time>
    </li>
  );
}

function Group({
  label,
  items,
  timeZone,
  onOpen,
}: {
  label: string;
  items: DoneItem[];
  timeZone: string;
  onOpen: (item: DoneItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="type-label-caps text-muted-foreground">{label}</h3>
      <ul aria-label={label}>
        {items.map((item) => (
          <Row key={`${item.type}:${item.id}`} item={item} timeZone={timeZone} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

export function DoneOnThisDay({
  done,
  timeZone,
  onAdd,
}: {
  done: DoneOnDay;
  timeZone: string;
  /** Copies the list into the note. Returns false when it could not (the editor is not ready). */
  onAdd: () => boolean;
}) {
  const headingId = useId();
  const panelId = useId();
  const openTask = useOpenTask();
  const [open, setOpen] = useState(true);
  const [added, setAdded] = useState(false);
  const [editing, setEditing] = useState<DoneItem | null>(null);

  const tasks = done.items.filter((i) => i.type === "task");
  const todos = done.items.filter((i) => i.type === "todo");
  const more = done.total - done.items.length;

  function openItem(item: DoneItem) {
    if (item.type === "task") openTask(item.id);
    else setEditing(item);
  }

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="-ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-1 text-left hover:text-foreground md:min-h-8"
        >
          <ChevronRight
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            strokeWidth={1.5}
            aria-hidden
          />
          <h2 id={headingId} className="type-headline-sm">
            Done on this day
          </h2>
          <span className="type-data-sm text-muted-foreground">{done.total}</span>
        </button>
        {done.total > 0 ? (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              if (onAdd()) setAdded(true);
            }}
          >
            <Plus strokeWidth={1.5} aria-hidden /> {added ? "Add again" : "Add to entry"}
          </Button>
        ) : null}
      </div>

      <div id={panelId} hidden={!open}>
        {done.total === 0 ? (
          <p className="mt-2 type-body-md text-muted-foreground">Nothing completed this day.</p>
        ) : (
          <>
            <Group label="Tasks" items={tasks} timeZone={timeZone} onOpen={openItem} />
            <Group label="Todos" items={todos} timeZone={timeZone} onOpen={openItem} />
            {more > 0 ? (
              <p className="mt-2 type-body-sm text-muted-foreground">and {more} more</p>
            ) : null}
          </>
        )}
      </div>
      {editing ? (
        <TodoEditDialog
          todo={asTodo(editing)}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}
