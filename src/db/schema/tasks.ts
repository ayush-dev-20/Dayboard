import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
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
import { canvases } from "./canvases";
import { projects } from "./projects";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Not cleared when a project is moved to Trash, so restoring the project brings the grouping back.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
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
    // Sticky notes (V3 feature 01 §13): a sticky note is a task of its own kind that is also an element of a drawing.
    // `sticky_canvas_id` says which drawing it is on, `sticky_tone` mirrors its colour. All null for an ordinary task.
    kind: text("kind").notNull().default("TASK"),
    stickyCanvasId: uuid("sticky_canvas_id").references((): AnyPgColumn => canvases.id, {
      onDelete: "cascade",
    }),
    stickyTone: text("sticky_tone"),
    // Sync (V2 feature 05): bumped by the server on every write; the device that made the last change.
    version: integer("version").notNull().default(1),
    lastModifiedByDeviceId: uuid("last_modified_by_device_id"),
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
    check("tasks_kind", sql`${t.kind} in ('TASK', 'STICKY')`),
    check(
      "tasks_sticky_has_canvas",
      sql`(${t.kind} = 'STICKY') = (${t.stickyCanvasId} is not null)`,
    ),
    check(
      "tasks_sticky_is_plain",
      sql`${t.kind} <> 'STICKY' or (${t.recurrenceRule} is null and ${t.parentTaskId} is null)`,
    ),
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_user_due_date_idx").on(t.userId, t.dueDate),
    index("tasks_user_updated_at_idx").on(t.userId, t.updatedAt),
    index("tasks_user_deleted_at_idx").on(t.userId, t.deletedAt),
    index("tasks_user_project_idx").on(t.userId, t.projectId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_sticky_order_idx")
      .on(t.stickyCanvasId, t.sortOrder)
      .where(sql`${t.kind} = 'STICKY'`),
    // "Done on this day" (V3 feature 02) filters by person and completion time.
    index("tasks_user_completed_at_idx")
      .on(t.userId, t.completedAt)
      .where(sql`${t.completedAt} is not null`),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
