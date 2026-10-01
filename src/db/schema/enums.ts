import { pgEnum } from "drizzle-orm/pg-core";

export const themeEnum = pgEnum("theme", ["light", "dark", "system"]);

// Shared with tasks (feature 02): `tasks.priority` uses the same enum.
export const taskPriorityEnum = pgEnum("task_priority", ["NONE", "LOW", "MEDIUM", "HIGH"]);

export const taskStatusEnum = pgEnum("task_status", [
  "INBOX",
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "DONE",
  "CANCELLED",
]);
