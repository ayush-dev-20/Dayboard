import type { DayPrefs } from "../dates/today";
import type { ProjectRef } from "../projects/dto";
import type { TagDTO } from "../tags";
import { clockFor, dueBucketOf, type DueBucket } from "./due-buckets";
import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER } from "./properties";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "./items";
import type { Collection } from "./types";

/** What the engine needs besides the items: the person's day and their workspace. */
export type EngineContext = {
  prefs: DayPrefs;
  now: Date;
  /** 0 is Sunday ... 6 is Saturday. */
  weekStart: number;
  /** All the person's projects and tags, so a board shows a column even when it is empty. */
  projects: readonly ProjectRef[];
  tags: readonly TagDTO[];
};

export type PropValue = string | number | boolean | string[] | null;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** An ISO timestamp as the person's calendar date ("YYYY-MM-DD"). */
export function isoToLocalDate(iso: string, timezone: string): string {
  let format = formatters.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timezone, format);
  }
  return format.format(new Date(iso));
}

/** Whether a task, todo or note is still open (a note always is). */
export function isOpenItem(collection: Collection, item: AnyItem): boolean {
  if (collection === "TASKS") {
    const status = (item as ViewTask).status;
    return status !== "DONE" && status !== "CANCELLED";
  }
  if (collection === "TODOS") return !(item as ViewTodo).isComplete;
  return true;
}

export function dueBucketFor(
  collection: Collection,
  item: AnyItem,
  ctx: EngineContext,
): DueBucket | "done" {
  const due = collection === "NOTES" ? null : (item as ViewTask | ViewTodo).dueDate;
  const time = collection === "TASKS" ? (item as ViewTask).dueTime : null;
  return dueBucketOf(
    { dueDate: due, dueTime: time, open: isOpenItem(collection, item) },
    clockFor(ctx),
  );
}

/** The value of a property for filtering: ids for selects, dates as "YYYY-MM-DD". */
export function getValue(
  collection: Collection,
  item: AnyItem,
  property: string,
  ctx: EngineContext,
): PropValue {
  const tz = ctx.prefs.timezone;
  switch (property) {
    case "title":
      return item.title;
    case "archived":
      return item.archived;
    case "project":
      return item.project?.id ?? null;
    case "tags":
      return (item as ViewTask | ViewNote).tags.map((t) => t.id);
    case "created":
      return isoToLocalDate(item.createdAt, tz);
    case "updated":
      return isoToLocalDate(item.updatedAt, tz);
    case "dueDate":
      return (item as ViewTask | ViewTodo).dueDate;
    case "startDate":
      return (item as ViewTask).startDate;
    case "status":
      return (item as ViewTask).status;
    case "priority":
      return (item as ViewTask).priority;
    case "subtasks":
      return (item as ViewTask).subtaskTotal;
    case "linkedNotes":
      return (item as ViewTask).noteCount;
    case "linkedTasks":
      return (item as ViewNote).taskCount;
    case "done":
      return (item as ViewTodo).isComplete;
    default:
      return null;
  }
}

/** A value to order by: numbers and strings that compare the way a person expects. */
export function getSortKey(
  collection: Collection,
  item: AnyItem,
  property: string,
  ctx: EngineContext,
): string | number | boolean | null {
  switch (property) {
    case "title":
      return item.title.toLocaleLowerCase();
    case "status":
      return TASK_STATUS_ORDER.indexOf((item as ViewTask).status);
    case "priority":
      return TASK_PRIORITY_ORDER.indexOf((item as ViewTask).priority);
    case "project":
      return item.project ? item.project.name.toLocaleLowerCase() : null;
    case "tags": {
      const names = (item as ViewTask | ViewNote).tags
        .map((t) => t.name.toLocaleLowerCase())
        .sort();
      return names.length > 0 ? names.join(",") : null;
    }
    // Whole timestamps, not days: two notes edited on the same day still sort by when.
    case "created":
      return item.createdAt;
    case "updated":
      return item.updatedAt;
    case "dueDate": {
      const task = item as ViewTask | ViewTodo;
      if (!task.dueDate) return null;
      // On one day, an item without a time comes before the timed ones.
      return `${task.dueDate} ${collection === "TASKS" ? ((item as ViewTask).dueTime ?? "") : ""}`;
    }
    default: {
      const value = getValue(collection, item, property, ctx);
      return Array.isArray(value) ? value.join(",") : value;
    }
  }
}

/** Where the engine falls back when there is no sort: the person's own order, then oldest first. */
export function manualCompare(a: AnyItem, b: AnyItem): number {
  const bySort = ("sortOrder" in a ? a.sortOrder : 0) - ("sortOrder" in b ? b.sortOrder : 0);
  if (bySort !== 0) return bySort;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
