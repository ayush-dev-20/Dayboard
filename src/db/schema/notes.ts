import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import type { TiptapDoc } from "../../lib/editor/types";
import { user } from "./auth";
import { projects } from "./projects";
import { tasks } from "./tasks";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Not cleared when a project is moved to Trash, so restoring the project brings the grouping back.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    emoji: text("emoji"),
    // Canonical content. The plain-text copy is always built on the server.
    contentJson: jsonb("content_json").$type<TiptapDoc>().notNull(),
    contentText: text("content_text").notNull().default(""),
    // Bumped on every content or title save; a stale save is refused (see feature doc §4).
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("notes_title_length", sql`char_length(${t.title}) <= 300`),
    index("notes_user_updated_at_idx").on(t.userId, t.updatedAt.desc()),
    index("notes_user_deleted_at_idx").on(t.userId, t.deletedAt),
    index("notes_user_project_idx").on(t.userId, t.projectId),
  ],
);

// Many-to-many: a task can link to several notes and a note to several tasks. `user_id` is kept on
// the row as a second line of defence; the server checks both sides belong to the person.
export const taskNotes = pgTable(
  "task_notes",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.noteId] }), index("task_notes_note_idx").on(t.noteId)],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
