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
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import type { Scene } from "../../lib/canvas/types";
import { user } from "./auth";
import { projects } from "./projects";
import { tasks } from "./tasks";

// Canvases (V3 feature 01 §2, docs/decisions/0017): a drawing (Excalidraw) or, in slice D, a sticky board. The scene
// is stored only after `sanitizeScene`; the plain-text copy for search and the element count are always built on the
// server and never taken from the client.
export const canvases = pgTable(
  "canvases",
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
    // `DRAWING` or `BOARD` (a sticky board, slice D).
    kind: text("kind").notNull().default("DRAWING"),
    sceneJson: jsonb("scene_json").$type<Scene>().notNull(),
    // The board's columns (slice D): set only when `kind = 'BOARD'`. The stickies are task rows, not in this column.
    boardJson: jsonb("board_json"),
    sceneText: text("scene_text").notNull().default(""),
    elementCount: integer("element_count").notNull().default(0),
    // Bumped on every accepted save; a stale save is refused (like notes).
    version: integer("version").notNull().default(1),
    // For the sync engine later (like `collection_views`).
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
    index("canvases_user_updated_idx").on(t.userId, t.updatedAt.desc()),
    index("canvases_user_deleted_idx").on(t.userId, t.deletedAt),
    index("canvases_user_project_idx").on(t.userId, t.projectId),
    check("canvases_title_length", sql`char_length(${t.title}) <= 300`),
    check("canvases_kind", sql`${t.kind} in ('DRAWING', 'BOARD')`),
    check("canvases_board_matches_kind", sql`(${t.kind} = 'BOARD') = (${t.boardJson} is not null)`),
    check("canvases_scene_text_length", sql`char_length(${t.sceneText}) <= 20000`),
  ],
);

// Many to many: a task can link to several canvases and a canvas to several tasks, like `task_notes`. `user_id` is kept
// on the row as a second line of defence; the server checks that both sides belong to the person. A link is not
// removed when a canvas goes to Trash or is archived, so Restore brings everything back; the lists hide a trashed one.
export const taskCanvases = pgTable(
  "task_canvases",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.canvasId] }),
    index("task_canvases_canvas_idx").on(t.canvasId),
  ],
);

export type Canvas = typeof canvases.$inferSelect;
export type NewCanvas = typeof canvases.$inferInsert;
