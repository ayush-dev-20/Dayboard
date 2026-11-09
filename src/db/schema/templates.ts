import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import type { TiptapDoc } from "../../lib/editor/types";
import { user } from "./auth";

// Templates (V3 feature 03 §2): a saved starting shape for a note or a journal entry. Their own table, not notes with a
// flag, so they can never show up in a Notes list, the tree, counts, search or the assistant. The document is stored
// only after `sanitizeTemplateDoc`, and the plain-text copy is always built on the server.
export const templates = pgTable(
  "templates",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji"),
    // May contain placeholders such as `Meeting: {{date}}`.
    titlePattern: text("title_pattern").notNull().default(""),
    contentJson: jsonb("content_json").$type<TiptapDoc>().notNull(),
    contentText: text("content_text").notNull().default(""),
    // Bumped on every accepted save; a stale save is refused.
    version: integer("version").notNull().default(1),
    // Set on the copy of a starter, so adding the starters twice does not duplicate them.
    starterKey: text("starter_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("templates_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check("templates_title_pattern_length", sql`char_length(${t.titlePattern}) <= 300`),
    index("templates_user_deleted_at_idx").on(t.userId, t.deletedAt),
    index("templates_user_updated_at_idx").on(t.userId, t.updatedAt.desc()),
    uniqueIndex("templates_user_starter_key_idx")
      .on(t.userId, t.starterKey)
      .where(sql`${t.starterKey} is not null and ${t.deletedAt} is null`),
  ],
);

export type Template = typeof templates.$inferSelect;
