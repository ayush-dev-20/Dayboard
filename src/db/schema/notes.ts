import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
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
    // Manual order for boards (V2 feature 06 §2) and, in the tree, among the notes of one parent
    // (feature 07 §2). New notes go to the top of their level.
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    // Sub-notes (V2 feature 07 §2). Permanently deleting a note removes its sub-notes with it.
    parentNoteId: uuid("parent_note_id").references((): AnyPgColumn => notes.id, {
      onDelete: "cascade",
    }),
    // 1 = top level. Kept in step by the server whenever a note is created or moved.
    depth: smallint("depth").notNull().default(1),
    // The same id on every note that went to Trash (or was archived) by one action on a parent, so
    // restoring brings back exactly that set and nothing that was already there.
    deletedCascadeId: uuid("deleted_cascade_id"),
    archivedCascadeId: uuid("archived_cascade_id"),
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
    check("notes_depth_range", sql`${t.depth} between 1 and 5`),
    check("notes_not_own_parent", sql`${t.parentNoteId} is null or ${t.parentNoteId} <> ${t.id}`),
    index("notes_user_updated_at_idx").on(t.userId, t.updatedAt.desc()),
    index("notes_user_deleted_at_idx").on(t.userId, t.deletedAt),
    index("notes_user_project_idx").on(t.userId, t.projectId),
    index("notes_user_sort_order_idx").on(t.userId, t.sortOrder),
    index("notes_user_parent_order_idx").on(t.userId, t.parentNoteId, t.sortOrder),
    index("notes_user_deleted_cascade_idx").on(t.userId, t.deletedCascadeId),
    index("notes_user_archived_cascade_idx").on(t.userId, t.archivedCascadeId),
  ],
);

// Where each note is mentioned (V2 feature 07 §2): one row per distinct note link in a note's or a
// task's text, rebuilt by the server on every save. Derived, never edited by a client. A sub-note
// block is hierarchy, not a link, so it is not stored here.
export const noteLinks = pgTable(
  "note_links",
  {
    sourceType: text("source_type", { enum: ["NOTE", "TASK"] }).notNull(),
    sourceId: uuid("source_id").notNull(),
    targetNoteId: uuid("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The words around the link, for the "Linked from" list.
    snippet: text("snippet").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId, t.targetNoteId] }),
    index("note_links_target_idx").on(t.targetNoteId),
    check("note_links_snippet_length", sql`char_length(${t.snippet}) <= 200`),
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
export type NoteLink = typeof noteLinks.$inferSelect;
