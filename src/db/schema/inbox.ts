import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { inboxStatusEnum } from "./enums";

/** What a converted inbox item became, for the "Converted to…" links. */
export type ConvertedRef = { type: "task" | "todo" | "note" | "project"; id: string };

// Inbox items are deliberately unstructured: just text, until the person converts them.
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: inboxStatusEnum("status").notNull().default("OPEN"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedRefs: jsonb("converted_refs").$type<ConvertedRef[]>(),
    // Written by feature 05 (AI suggestions). Declared now so that feature needs no migration.
    aiSuggestion: jsonb("ai_suggestion"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("inbox_items_text_length", sql`char_length(${t.text}) between 1 and 5000`),
    check(
      "inbox_items_converted_has_time",
      sql`(${t.status} = 'CONVERTED') = (${t.convertedAt} is not null)`,
    ),
    index("inbox_items_user_status_created_idx").on(t.userId, t.status, t.createdAt.desc()),
    index("inbox_items_user_deleted_at_idx").on(t.userId, t.deletedAt),
  ],
);

export type InboxItem = typeof inboxItems.$inferSelect;
