import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { notes } from "./notes";

// Real-time collaboration (V3 feature 05, docs/decisions/0019). The live state of a note being edited by more than
// one person, and safety-net snapshots of it. `notes` stays the source of truth for everything that is not live.

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const SNAPSHOT_REASONS = ["INTERVAL", "LAST_DISCONNECT", "BEFORE_ROLLBACK"] as const;

export const noteCollabDocs = pgTable("note_collab_docs", {
  noteId: uuid("note_id")
    .primaryKey()
    .references(() => notes.id, { onDelete: "cascade" }),
  // The current Yjs state (title and emoji are in its "meta" map).
  ydoc: bytea("ydoc").notNull(),
  // The `notes.version` the document was seeded from, and the one the projector last wrote.
  baseVersion: integer("base_version").notNull(),
  projectedVersion: integer("projected_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const noteSnapshots = pgTable(
  "note_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    ydoc: bytea("ydoc").notNull(),
    // The sanitised projection at that moment.
    contentJson: jsonb("content_json").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("note_snapshots_note_created_idx").on(t.noteId, t.createdAt.desc()),
    check(
      "note_snapshots_reason",
      sql`${t.reason} in ('INTERVAL', 'LAST_DISCONNECT', 'BEFORE_ROLLBACK')`,
    ),
  ],
);

export type NoteCollabDoc = typeof noteCollabDocs.$inferSelect;
export type NoteSnapshot = typeof noteSnapshots.$inferSelect;
