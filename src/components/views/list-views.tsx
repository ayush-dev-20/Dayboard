"use client";

import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { NoteCard, NoteTile } from "@/components/notes/note-card";
import { buttonVariants } from "@/components/ui/button";
import { TaskList, type TaskGroupData } from "@/components/tasks/task-list";
import { TodoList } from "@/components/tasks/todo-list";
import { startOfUserDay } from "@/lib/dates/today";
import { PAGE_SIZE } from "@/lib/views/engine";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import type { ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { ViewState } from "./view-state";

// The List and Gallery views: the V1 lists (the same components, so a row looks and behaves as it
// always did), fed by the view engine instead of by hand-written grouping (V2 feature 06 §5).

/** The page without its quick filters. The view itself is the one remembered on this device. */
const clearHref = (basePath: string, linkParams?: Record<string, string>) => {
  const query = new URLSearchParams(linkParams).toString();
  return query ? `${basePath}?${query}` : basePath;
};

const isOpenTask = (t: ViewTask) => t.status !== "DONE" && t.status !== "CANCELLED";

/** Newest finished first, as the V1 Completed section shows them. */
const byCompleted = (a: ViewTask | ViewTodo, b: ViewTask | ViewTodo) =>
  (b.completedAt ?? "").localeCompare(a.completedAt ?? "");

export function TasksListBody({
  state,
  counts,
  selectedId,
  hideProject,
  basePath,
  linkParams,
}: {
  state: ViewState;
  counts: { open: number; done: number };
  selectedId: string | null;
  hideProject?: boolean;
  basePath: string;
  linkParams?: Record<string, string>;
}) {
  const { effective, result } = state;
  const items = result.items as ViewTask[];
  const hasFilters = effective.filters.length > 0;

  const groups: TaskGroupData[] = result.groups
    .map((g) => ({
      key: g.key,
      label: g.label || "Tasks",
      tasks: (g.items as ViewTask[]).filter(isOpenTask),
    }))
    .filter((g) => g.tasks.length > 0);
  const closed = items.filter((t) => !isOpenTask(t));
  if (effective.sorts.length === 0) closed.sort(byCompleted);
  const closedShown = closed.slice(0, PAGE_SIZE);

  const nothingAtAll = counts.open === 0 && counts.done === 0 && !hasFilters;
  const noMatches = groups.length === 0 && closed.length === 0 && hasFilters;

  if (nothingAtAll) {
    return (
      <div className="mt-8">
        <EmptyState
          illustration="tasks-empty"
          title="No tasks yet."
          description="Add one above, or press N."
        >
          <Link href="/inbox" className={buttonVariants({ variant: "secondary" })}>
            Go to Inbox
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (noMatches) {
    return (
      <div className="mt-8">
        <EmptyState
          title="No tasks match these filters."
          description="Nothing is hidden or deleted."
        >
          <Link
            href={clearHref(basePath, linkParams)}
            className={buttonVariants({ variant: "secondary" })}
          >
            Clear filters
          </Link>
        </EmptyState>
      </div>
    );
  }

  const doneShown = effective.filters.some((f) => f.property === "dueDate")
    ? 0
    : Math.max(counts.done, closed.length);
  const onlyClosed = effective.filters.some(
    (f) =>
      f.property === "status" &&
      Array.isArray(f.value) &&
      (f.value as string[]).every((s) => s === "DONE" || s === "CANCELLED"),
  );

  return (
    <div className="mt-8">
      <TaskList
        groups={groups}
        closed={closedShown}
        doneCount={doneShown}
        selectedId={selectedId}
        completedOpenByDefault={onlyClosed}
        hideProject={hideProject}
      />
      {closed.length > closedShown.length ? (
        <p className="mt-3 type-body-sm text-muted-foreground">
          Showing the {closedShown.length} most recent of {closed.length} completed tasks.
        </p>
      ) : null}
    </div>
  );
}

export function TodosListBody({ state }: { state: ViewState }) {
  const { effective, result, ctx } = state;
  const all = result.items as ViewTodo[];
  const since = startOfUserDay(ctx.prefs, ctx.now).toISOString();
  const showsDone = effective.filters.some((f) => f.property === "done");
  const completed = all
    .filter((t) => t.isComplete && (showsDone || (t.completedAt ?? "") >= since))
    .sort(byCompleted);
  const openCount = all.filter((t) => !t.isComplete).length;

  if (openCount === 0 && completed.length === 0) {
    return (
      <div className="mt-8">
        {effective.filters.length > 0 ? (
          <EmptyState
            title="No todos match these filters."
            description="Nothing is hidden or deleted."
          />
        ) : (
          <EmptyState
            illustration="tasks-empty"
            title="No todos yet."
            description="Add one above, or press T."
          />
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      {effective.groupBy === null ? (
        <TodoList open={all.filter((t) => !t.isComplete)} completed={completed} />
      ) : (
        <div className="flex flex-col gap-8">
          {result.groups
            .map((g) => ({ ...g, open: (g.items as ViewTodo[]).filter((t) => !t.isComplete) }))
            .filter((g) => g.open.length > 0)
            .map((g) => (
              <TodoList key={g.key} open={g.open} completed={[]} openLabel={g.label} />
            ))}
          {completed.length > 0 ? <TodoList open={[]} completed={completed} /> : null}
        </div>
      )}
      <p className="mt-6 type-body-md text-muted-foreground">
        Todos are quick checkboxes. They have no priority, subtasks or tags.
      </p>
    </div>
  );
}

export function NotesListBody({
  state,
  archived,
  archivedCount,
  nothingAtAll,
  now,
}: {
  state: ViewState;
  archived: NoteListItemDTO[];
  archivedCount: number;
  nothingAtAll: boolean;
  now: Date;
}) {
  const { effective, result, ctx, view, collection } = state;
  const notes = result.items as ViewNote[];
  const gallery = view.type === "GALLERY";
  const size = state.config.cardSize ?? "medium";
  const filtered = effective.filters.length > 0;
  const [shown, setShown] = useState(PAGE_SIZE);
  const timeZone = ctx.prefs.timezone;

  if (nothingAtAll) {
    return (
      <div className="mt-4">
        <EmptyState
          illustration="notes-empty"
          title="No notes yet."
          description="Notes autosave as you type. Press Shift+N from anywhere."
        >
          <Link href="/notes/new" className={buttonVariants()}>
            <Plus strokeWidth={1.5} aria-hidden /> New note
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (notes.length === 0 && archived.length === 0 && filtered) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No notes match these filters."
          description="Nothing is hidden or deleted."
        >
          <Link href="/notes" className={buttonVariants({ variant: "secondary" })}>
            Clear filters
          </Link>
        </EmptyState>
      </div>
    );
  }

  const visible = notes.slice(0, shown);
  const grid = cn(
    "grid gap-4",
    size === "small" && "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
    size === "medium" && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
    size === "large" && "grid-cols-1 lg:grid-cols-2",
  );

  return (
    <div className="mt-4">
      {notes.length > 0 ? (
        gallery ? (
          <ul className={grid} aria-label="Notes">
            {visible.map((note) => (
              <NoteTile key={note.id} note={note} now={now} timeZone={timeZone} />
            ))}
          </ul>
        ) : (
          <ul className="border-t border-border" aria-label="Notes">
            {visible.map((note) => (
              <NoteCard key={note.id} note={note} now={now} timeZone={timeZone} />
            ))}
          </ul>
        )
      ) : (
        <p className="py-4 type-body-md text-muted-foreground">
          No notes here. Archived notes are below.
        </p>
      )}
      {notes.length > visible.length ? (
        <Button variant="secondary" className="mt-4" onClick={() => setShown((n) => n + PAGE_SIZE)}>
          Show more ({notes.length - visible.length})
        </Button>
      ) : null}

      {collection === "NOTES" && archived.length > 0 ? (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
              strokeWidth={1.5}
              aria-hidden
            />
            Archived
            <span className="type-data-sm">{archivedCount}</span>
          </summary>
          <ul className="border-t border-border" aria-label="Archived notes">
            {archived.map((note) => (
              <NoteCard key={note.id} note={note} now={now} timeZone={timeZone} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
