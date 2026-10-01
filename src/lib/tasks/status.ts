export const TASK_STATUSES = [
  "INBOX",
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "DONE",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OPEN_STATUSES = ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"] as const;
export const CLOSED_STATUSES = ["DONE", "CANCELLED"] as const;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  INBOX: "Inbox",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  NONE: "None",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export function isOpenStatus(status: TaskStatus): boolean {
  return status !== "DONE" && status !== "CANCELLED";
}

/** Bars filled in the priority glyph. None draws nothing in a list. */
export function priorityBars(priority: TaskPriority): 0 | 1 | 2 | 3 {
  return priority === "HIGH" ? 3 : priority === "MEDIUM" ? 2 : priority === "LOW" ? 1 : 0;
}

export type StatusPatch = { status: TaskStatus; completedAt: Date | null };

/**
 * The one place the invariant lives: `completedAt` is set if and only if the status is DONE.
 * (The database enforces the same rule with a check constraint.)
 */
export function statusPatch(status: TaskStatus, now: Date): StatusPatch {
  return { status, completedAt: status === "DONE" ? now : null };
}

/** Where a task goes when completion is undone. It never returns to DONE. */
export function statusAfterUndo(previous: TaskStatus): TaskStatus {
  return previous === "DONE" ? "PLANNED" : previous;
}

/** Where a completed task goes when ticked off again from the Completed list. */
export const UNCOMPLETE_STATUS: TaskStatus = "PLANNED";
