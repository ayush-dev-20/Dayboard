import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/ids";
import { user } from "./auth";
import { colorTokenEnum, projectStatusEnum } from "./enums";

// Projects are personal and flat. Tasks, todos and notes may belong to one, never have to.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("ACTIVE"),
    color: colorTokenEnum("color").notNull().default("slate"),
    // Set and cleared together with status ARCHIVED.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("projects_name_length", sql`char_length(${t.name}) between 1 and 100`),
    check(
      "projects_description_length",
      sql`${t.description} is null or char_length(${t.description}) <= 2000`,
    ),
    check(
      "projects_archived_matches_status",
      sql`(${t.status} = 'ARCHIVED') = (${t.archivedAt} is not null)`,
    ),
    index("projects_user_status_idx").on(t.userId, t.status),
    index("projects_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    index("projects_user_deleted_at_idx").on(t.userId, t.deletedAt),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
