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

export const projectStatusEnum = pgEnum("project_status", [
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
]);

// Colour tokens, never raw hex: they map to the `--tag-*` CSS variables (DESIGN.md).
export const colorTokenEnum = pgEnum("color_token", [
  "slate",
  "red",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
]);

export const inboxStatusEnum = pgEnum("inbox_status", ["OPEN", "CONVERTED", "ARCHIVED"]);

// The AI features (feature 05). Keys match `src/lib/ai/types.ts`.
export const aiFeatureEnum = pgEnum("ai_feature", [
  "EXTRACT_TASKS",
  "SUBTASKS",
  "SUMMARIZE_NOTE",
  "ACTION_ITEMS",
  "ASK",
  "DAILY",
  "OVERDUE_CLEANUP",
  "TASK_ASSIST",
  "CLASSIFY_INBOX",
]);

export const aiUsageStatusEnum = pgEnum("ai_usage_status", [
  "SUCCESS",
  "PROVIDER_ERROR",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
]);
