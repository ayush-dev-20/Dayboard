import { DUE_FILTERS, type DueFilter } from "./grouping";
import { OPEN_STATUSES, TASK_STATUSES, type TaskStatus } from "./status";

export type TasksView = "tasks" | "todos";

export type TasksParams = {
  view: TasksView;
  statuses: TaskStatus[];
  due: DueFilter;
  archived: boolean;
  /** The task open in the detail sheet. */
  taskId: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Reads the /tasks URL. Anything unrecognised falls back to the default instead of failing. */
export function parseTasksParams(raw: RawParams): TasksParams {
  const view: TasksView = first(raw.view) === "todos" ? "todos" : "tasks";

  const wanted = (first(raw.status) ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s));
  const statuses = wanted.length > 0 ? [...new Set(wanted)] : [...OPEN_STATUSES];

  const dueRaw = first(raw.due);
  const due = DUE_FILTERS.find((d) => d === dueRaw) ?? "any";

  const taskRaw = first(raw.task);
  const taskId = taskRaw && UUID.test(taskRaw) ? taskRaw : null;

  return { view, statuses, due, archived: first(raw.archived) === "1", taskId };
}

export function isDefaultStatuses(statuses: readonly TaskStatus[]): boolean {
  return sameSet(statuses, OPEN_STATUSES);
}

/** The query string for the current choices ("" when everything is at its default). */
export function buildTasksQuery(params: Partial<TasksParams>): string {
  const q = new URLSearchParams();
  if (params.view === "todos") q.set("view", "todos");
  if (params.statuses && !isDefaultStatuses(params.statuses)) {
    q.set("status", params.statuses.map((s) => s.toLowerCase()).join(","));
  }
  if (params.due && params.due !== "any") q.set("due", params.due);
  if (params.archived) q.set("archived", "1");
  if (params.taskId) q.set("task", params.taskId);
  const text = q.toString();
  return text ? `?${text}` : "";
}

export function hasActiveFilters(params: TasksParams): boolean {
  return !isDefaultStatuses(params.statuses) || params.due !== "any" || params.archived;
}

/** A short label for the Status filter button. */
export function describeStatuses(statuses: readonly TaskStatus[]): string {
  if (isDefaultStatuses(statuses)) return "Open";
  if (statuses.length === 1) {
    const labels: Record<TaskStatus, string> = {
      INBOX: "Inbox",
      PLANNED: "Planned",
      IN_PROGRESS: "In progress",
      WAITING: "Waiting",
      DONE: "Done",
      CANCELLED: "Cancelled",
    };
    return labels[statuses[0] as TaskStatus];
  }
  return `${statuses.length} selected`;
}
