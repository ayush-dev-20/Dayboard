import { addDays, compareDates, weekdayIndex } from "../dates/calendar";
import { getUserToday } from "../dates/today";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "../tasks/status";
import { DUE_BUCKET_LABELS, endOfWeek, startOfNextWeek } from "./due-buckets";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "./items";
import { NO_VALUE_KEY } from "./group";
import type { Collection } from "./types";
import type { EngineContext } from "./values";

// What dropping a card on a column means (V2 feature 06 §5). Pure: the drag layer reports "this
// item, from this column, onto that one", and this module answers with the ordinary commands that
// make it true (or says why it cannot). Nothing here knows about the browser or the network.

export type MoveCommand =
  | { type: "task.status"; id: string; status: TaskStatus; from: TaskStatus }
  | { type: "task.priority"; id: string; priority: TaskPriority; from: TaskPriority }
  | { type: "task.dueDate"; id: string; dueDate: string | null; from: string | null }
  | { type: "todo.done"; id: string; done: boolean }
  | { type: "todo.dueDate"; id: string; dueDate: string | null; from: string | null }
  | {
      type: "project";
      itemType: "task" | "todo" | "note";
      id: string;
      projectId: string | null;
      from: string | null;
    }
  | { type: "tags"; itemType: "task" | "note"; id: string; tagIds: string[]; from: string[] }
  // Edits made in a table cell or a bulk action: not drops, but the same kind of command.
  | { type: "task.title"; id: string; title: string; from: string }
  | { type: "task.startDate"; id: string; startDate: string | null; from: string | null }
  | { type: "todo.title"; id: string; title: string; from: string }
  | { type: "note.title"; id: string; title: string; from: string; version: number }
  | { type: "archive"; itemType: "task" | "todo" | "note"; id: string; archived: boolean }
  | { type: "trash"; itemType: "task" | "todo" | "note"; id: string };

export type MovePlan =
  { ok: true; commands: MoveCommand[]; message: string } | { ok: false; reason: string };

const refuse = (reason: string): MovePlan => ({ ok: false, reason });
const done = (commands: MoveCommand[], message: string): MovePlan => ({
  ok: true,
  commands,
  message,
});

/**
 * The date a card gets when dropped on a due bucket. `current` is its present due date (kept as a
 * weekday for "This week").
 */
export function dateForBucket(
  bucket: string,
  current: string | null,
  ctx: EngineContext,
): { date: string | null } | { refused: string } {
  const today = getUserToday(ctx.prefs, ctx.now);
  switch (bucket) {
    case "today":
      return { date: today };
    case "none":
      return { date: null };
    case "week": {
      const end = endOfWeek(today, ctx.weekStart);
      if (compareDates(today, end) >= 0) return { refused: "There are no days left in this week." };
      // Keep the weekday when that day is still ahead this week, otherwise tomorrow.
      if (current) {
        const wanted = weekdayIndex(current);
        for (let day = addDays(today, 1); compareDates(day, end) <= 0; day = addDays(day, 1)) {
          if (weekdayIndex(day) === wanted) return { date: day };
        }
      }
      return { date: addDays(today, 1) };
    }
    case "later":
      return { date: startOfNextWeek(today, ctx.weekStart) };
    case "overdue":
      return { refused: "Overdue comes from a date in the past, so nothing can be dropped there." };
    default:
      return { refused: "That column can't be dropped on." };
  }
}

/** Where the card is being dropped, by group key. `from` is the column it was dragged out of. */
export function planMove(
  collection: Collection,
  groupBy: string,
  item: AnyItem,
  to: { key: string; droppable: boolean; label: string },
  from: string | null,
  ctx: EngineContext,
): MovePlan {
  if (!to.droppable) {
    return refuse(
      to.key === "overdue"
        ? "Overdue comes from a date in the past, so nothing can be dropped there."
        : `You can't drop a card on ${to.label}.`,
    );
  }

  // ---- Tasks -----------------------------------------------------------------------------
  if (collection === "TASKS") {
    const task = item as ViewTask;
    switch (groupBy) {
      case "status": {
        const status = to.key as TaskStatus;
        if (status === task.status) return refuse("It is already there.");
        return done(
          [{ type: "task.status", id: task.id, status, from: task.status }],
          `Moved to ${STATUS_LABELS[status]}.`,
        );
      }
      case "priority": {
        const priority = to.key as TaskPriority;
        if (priority === task.priority) return refuse("It is already there.");
        return done(
          [{ type: "task.priority", id: task.id, priority, from: task.priority }],
          `Priority set to ${PRIORITY_LABELS[priority]}.`,
        );
      }
      case "project": {
        const projectId = to.key === NO_VALUE_KEY ? null : to.key;
        if ((task.project?.id ?? null) === projectId) return refuse("It is already there.");
        return done(
          [
            {
              type: "project",
              itemType: "task",
              id: task.id,
              projectId,
              from: task.project?.id ?? null,
            },
          ],
          projectId ? `Moved to ${to.label}.` : "Removed from its project.",
        );
      }
      case "tag":
        return planTagMove("task", task, to, from);
      case "dueBucket":
      case "dueList": {
        const bucket = to.key === "upcoming" ? "week" : to.key;
        const target = dateForBucket(bucket, task.dueDate, ctx);
        if ("refused" in target) return refuse(target.refused);
        if (target.date === null && task.recurrenceRule) {
          return refuse("A repeating task needs a due date.");
        }
        if (target.date === task.dueDate) return refuse("It is already there.");
        return done(
          [{ type: "task.dueDate", id: task.id, dueDate: target.date, from: task.dueDate }],
          target.date
            ? `Due date set to ${DUE_BUCKET_LABELS[bucket as keyof typeof DUE_BUCKET_LABELS]}.`
            : "Due date cleared.",
        );
      }
      default:
        return refuse("That can't be changed by dragging.");
    }
  }

  // ---- Todos -----------------------------------------------------------------------------
  if (collection === "TODOS") {
    const todo = item as ViewTodo;
    switch (groupBy) {
      case "done": {
        const next = to.key === "done";
        if (next === todo.isComplete) return refuse("It is already there.");
        return done(
          [{ type: "todo.done", id: todo.id, done: next }],
          next ? "Marked done." : "Marked not done.",
        );
      }
      case "project": {
        const projectId = to.key === NO_VALUE_KEY ? null : to.key;
        if ((todo.project?.id ?? null) === projectId) return refuse("It is already there.");
        return done(
          [
            {
              type: "project",
              itemType: "todo",
              id: todo.id,
              projectId,
              from: todo.project?.id ?? null,
            },
          ],
          projectId ? `Moved to ${to.label}.` : "Removed from its project.",
        );
      }
      case "dueBucket": {
        const target = dateForBucket(to.key, todo.dueDate, ctx);
        if ("refused" in target) return refuse(target.refused);
        if (target.date === todo.dueDate) return refuse("It is already there.");
        return done(
          [{ type: "todo.dueDate", id: todo.id, dueDate: target.date, from: todo.dueDate }],
          target.date
            ? `Due date set to ${DUE_BUCKET_LABELS[to.key as keyof typeof DUE_BUCKET_LABELS]}.`
            : "Due date cleared.",
        );
      }
      default:
        return refuse("That can't be changed by dragging.");
    }
  }

  // ---- Notes -----------------------------------------------------------------------------
  const note = item as ViewNote;
  if (groupBy === "project") {
    const projectId = to.key === NO_VALUE_KEY ? null : to.key;
    if ((note.project?.id ?? null) === projectId) return refuse("It is already there.");
    return done(
      [
        {
          type: "project",
          itemType: "note",
          id: note.id,
          projectId,
          from: note.project?.id ?? null,
        },
      ],
      projectId ? `Moved to ${to.label}.` : "Removed from its project.",
    );
  }
  if (groupBy === "tag") return planTagMove("note", note, to, from);
  return refuse("That can't be changed by dragging.");
}

/**
 * Dragging between tag columns moves one tag: the source tag comes off and the target goes on, and
 * the card keeps its other tags. Dropping on "No tag" only takes the source tag off.
 */
function planTagMove(
  itemType: "task" | "note",
  item: ViewTask | ViewNote,
  to: { key: string; label: string },
  from: string | null,
): MovePlan {
  const current = item.tags.map((t) => t.id);
  if (to.key !== NO_VALUE_KEY && current.includes(to.key) && from === to.key) {
    return refuse("It is already there.");
  }
  let next = current.filter((id) => id !== from || from === NO_VALUE_KEY);
  if (to.key !== NO_VALUE_KEY && !next.includes(to.key)) next = [...next, to.key];
  if (next.length === current.length && next.every((id) => current.includes(id))) {
    return refuse("It already has that tag.");
  }
  const message =
    to.key === NO_VALUE_KEY
      ? "Tag removed."
      : from && from !== NO_VALUE_KEY
        ? `Moved to ${to.label}.`
        : `Tagged ${to.label}.`;
  return done([{ type: "tags", itemType, id: item.id, tagIds: next, from: current }], message);
}
