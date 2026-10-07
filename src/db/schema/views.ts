import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
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
import type { ViewConfig } from "../../lib/views/types";
import { user } from "./auth";
import { viewCollectionEnum, viewTypeEnum } from "./enums";

// A saved way to look at tasks, todos or notes (V2 feature 06 §2). The sync columns (`version`,
// `last_modified_by_device_id`, `deleted_at`) are here from the start so features 04 and 05 can
// sync views without a change of shape. A collection always keeps at least one live view.
export const collectionViews = pgTable(
  "collection_views",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collection: viewCollectionEnum("collection").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    type: viewTypeEnum("type").notNull(),
    // Tab order, as a fractional key so a move changes one row.
    position: doublePrecision("position").notNull(),
    config: jsonb("config").$type<ViewConfig>().notNull(),
    version: integer("version").notNull().default(1),
    lastModifiedByDeviceId: uuid("last_modified_by_device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("collection_views_name_length", sql`char_length(${t.name}) between 1 and 60`),
    index("collection_views_user_collection_idx").on(
      t.userId,
      t.collection,
      t.deletedAt,
      t.position,
    ),
  ],
);

export type CollectionView = typeof collectionViews.$inferSelect;
export type NewCollectionView = typeof collectionViews.$inferInsert;
