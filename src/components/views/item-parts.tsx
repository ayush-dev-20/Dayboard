"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DueChip } from "@/components/tasks/due-chip";
import { PriorityGlyph } from "@/components/tasks/priority-glyph";
import { useTaskContext } from "@/components/tasks/task-context";
import { TodoEditDialog } from "@/components/tasks/todo-edit-dialog";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { ProjectToken, TagBadge } from "@/components/workspace/tokens";
import { formatCompact } from "@/lib/dates/relative";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import type { Collection, OpenIn } from "@/lib/views/types";

// Pieces every view shares (V2 feature 06 §5): how an item opens, and the small facts shown on a
// card. They reuse the V1 chips (due date with its overdue styling, priority bars, project and tag
// tokens), so an item looks the same on a board as in a list.

/**
 * The item's title as a control that opens it the usual way: a task in the side panel (or its own
 * page, when the view says so), a todo in its edit dialog, a note on its page.
 */
export function OpenTitle({
  collection,
  item,
  openIn,
  className,
  children,
}: {
  collection: Collection;
  item: AnyItem;
  openIn: OpenIn;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const openTask = useOpenTask();
  const [editing, setEditing] = useState(false);

  if (collection === "NOTES") {
    return (
      <Link href={`/notes/${item.id}`} className={className}>
        {children}
      </Link>
    );
  }
  if (collection === "TODOS") {
    return (
      <>
        <button type="button" onClick={() => setEditing(true)} className={className}>
          {children}
        </button>
        <TodoEditDialog todo={item as ViewTodo} open={editing} onOpenChange={setEditing} />
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={() => (openIn === "page" ? router.push(`/tasks/${item.id}`) : openTask(item.id))}
      className={className}
    >
      {children}
    </button>
  );
}

/** The facts shown under a card's title, in the order the view's visible properties list them. */
export function ItemFields({
  collection,
  item,
  fields,
}: {
  collection: Collection;
  item: AnyItem;
  fields: readonly string[];
}) {
  const { prefs, nowMs } = useTaskContext();
  const show = (id: string) => fields.includes(id);
  const parts: React.ReactNode[] = [];

  if (collection !== "NOTES") {
    const dated = item as ViewTask | ViewTodo;
    const closed =
      collection === "TASKS"
        ? (item as ViewTask).status === "DONE" || (item as ViewTask).status === "CANCELLED"
        : (item as ViewTodo).isComplete;
    if (show("dueDate") && dated.dueDate) {
      parts.push(
        <DueChip
          key="due"
          dueDate={dated.dueDate}
          dueTime={collection === "TASKS" ? (item as ViewTask).dueTime : null}
          status={closed ? "DONE" : "PLANNED"}
          prefs={prefs}
          nowMs={nowMs}
        />,
      );
    }
  }
  if (collection === "TASKS") {
    const task = item as ViewTask;
    if (show("priority") && task.priority !== "NONE") {
      parts.push(<PriorityGlyph key="priority" priority={task.priority} />);
    }
    if (show("subtasks") && task.subtaskTotal > 0) {
      parts.push(
        <span key="subtasks" className="type-data-sm text-muted-foreground">
          <span className="sr-only">Subtasks done: </span>
          {task.subtaskDone}/{task.subtaskTotal}
        </span>,
      );
    }
  }
  if (show("project") && item.project) {
    parts.push(
      <span key="project" className="flex max-w-36 min-w-0">
        <span className="sr-only">Project: </span>
        <ProjectToken project={item.project} />
      </span>,
    );
  }
  if (collection !== "TODOS" && show("tags")) {
    const tags = (item as ViewTask | ViewNote).tags;
    if (tags.length > 0) {
      parts.push(
        <span key="tags" className="flex flex-wrap items-center gap-1">
          <span className="sr-only">Tags: </span>
          {tags.slice(0, 2).map((tag) => (
            <TagBadge key={tag.id} tag={tag} className="max-w-24" />
          ))}
          {tags.length > 2 ? (
            <span className="type-body-sm text-muted-foreground">+{tags.length - 2}</span>
          ) : null}
        </span>,
      );
    }
  }
  if (collection === "NOTES" && show("updated")) {
    const note = item as ViewNote;
    parts.push(
      <time key="updated" dateTime={note.updatedAt} className="type-data-sm text-muted-foreground">
        <span className="sr-only">Updated </span>
        {formatCompact(new Date(note.updatedAt), new Date(nowMs), prefs.timezone)}
      </time>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{parts}</div>;
}
