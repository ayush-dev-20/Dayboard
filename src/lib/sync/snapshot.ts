import type { TaskPriority, TaskStatus } from "@/lib/tasks/status";

// What the offline app stores, and what `GET /api/sync/snapshot` sends (V2 feature 04 §4). Plain
// values only: dates as ISO strings, no internals. Field names match the server's task columns so the
// same Zod schemas apply to both sides.

export const SNAPSHOT_ENTITIES = ["tasks", "preferences"] as const;
export type SnapshotEntity = (typeof SNAPSHOT_ENTITIES)[number];

/** Rows deleted this long ago are still sent, so the device learns about the deletion. */
export const TOMBSTONE_DAYS = 30;
export const SNAPSHOT_MAX_LIMIT = 500;

export type SnapshotTask = {
  id: string;
  projectId: string | null;
  parentTaskId: string | null;
  title: string;
  emoji: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
  recurrenceRule: string | null;
  recurrenceParentId: string | null;
  sortOrder: number;
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Bumped by the server on every write. The newer version wins on a device (ADR 0007). */
  version: number;
};

export type SnapshotPreferences = {
  defaultTaskPriority: TaskPriority;
  timezone: string;
  startOfDay: string;
};

export type SnapshotPage<T> = { rows: T[]; nextCursor: string | null };
