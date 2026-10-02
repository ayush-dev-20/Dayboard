import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { colorTokenEnum } from "./enums";
import { notes } from "./notes";
import { tasks } from "./tasks";

// Tags apply to tasks and notes only (todos and projects don't take tags in V1).
export const tags = pgTable(
  "tags",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // What the person typed; `normalizedName` (trimmed, lower-cased, spaces collapsed) decides uniqueness.
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    color: colorTokenEnum("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("tags_name_length", sql`char_length(${t.name}) between 1 and 40`),
    unique("tags_user_normalized_name_unique").on(t.userId, t.normalizedName),
  ],
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_tag_idx").on(t.tagId)],
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] }), index("note_tags_tag_idx").on(t.tagId)],
);

export type Tag = typeof tags.$inferSelect;
