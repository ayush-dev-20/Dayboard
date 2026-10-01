import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import type { TiptapDoc } from "../../lib/editor/types";
import { user } from "./auth";
import { taskPriorityEnum, taskStatusEnum } from "./enums";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Foreign key to `projects` is added by feature 03, which creates that table.
    projectId: uuid("project_id"),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    emoji: text("emoji"),
    descriptionJson: jsonb("description_json").$type<TiptapDoc>(),
    descriptionText: text("description_text"),
    status: taskStatusEnum("status").notNull().default("PLANNED"),
    priority: taskPriorityEnum("priority").notNull().default("NONE"),
    // Local calendar date and optional local time (see feature doc §3), not a timestamp.
    dueDate: date("due_date", { mode: "string" }),
    dueTime: time("due_time"),
    startDate: date("start_date", { mode: "string" }),
    startTime: time("start_time"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    recurrenceRule: text("recurrence_rule"),
    recurrenceParentId: uuid("recurrence_parent_id"),
    sortOrder: doublePrecision("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("tasks_title_length", sql`char_length(${t.title}) between 1 and 500`),
    check(
      "tasks_done_has_completed_at",
      sql`(${t.status} = 'DONE') = (${t.completedAt} is not null)`,
    ),
    check("tasks_due_time_needs_date", sql`${t.dueTime} is null or ${t.dueDate} is not null`),
    check("tasks_start_time_needs_date", sql`${t.startTime} is null or ${t.startDate} is not null`),
    check("tasks_not_own_parent", sql`${t.parentTaskId} <> ${t.id}`),
    check(
      "tasks_recurring_needs_due_date",
      sql`${t.recurrenceRule} is null or ${t.dueDate} is not null`,
    ),
    check(
      "tasks_subtask_does_not_recur",
      sql`${t.parentTaskId} is null or ${t.recurrenceRule} is null`,
    ),
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_user_due_date_idx").on(t.userId, t.dueDate),
    index("tasks_user_updated_at_idx").on(t.userId, t.updatedAt),
    index("tasks_user_deleted_at_idx").on(t.userId, t.deletedAt),
    index("tasks_user_project_idx").on(t.userId, t.projectId),
    index("tasks_parent_idx").on(t.parentTaskId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
