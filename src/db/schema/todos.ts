import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";

// Todos are deliberately light: no description, priority, tags, subtasks or links (product spec §6.4).
export const todos = pgTable(
  "todos",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Foreign key to `projects` is added by feature 03.
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    emoji: text("emoji"),
    isComplete: boolean("is_complete").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dueDate: date("due_date", { mode: "string" }),
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
    check("todos_title_length", sql`char_length(${t.title}) between 1 and 300`),
    check("todos_complete_has_completed_at", sql`${t.isComplete} = (${t.completedAt} is not null)`),
    index("todos_user_open_order_idx").on(t.userId, t.isComplete, t.sortOrder),
    index("todos_user_due_date_idx").on(t.userId, t.dueDate),
    index("todos_user_project_idx").on(t.userId, t.projectId),
    index("todos_user_deleted_at_idx").on(t.userId, t.deletedAt),
  ],
);

export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
