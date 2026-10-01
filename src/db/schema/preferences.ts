import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { taskPriorityEnum, themeEnum } from "./enums";

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    theme: themeEnum("theme").notNull().default("system"),
    // IANA name. Drives "today" and "overdue" in features 02 and 04. Detected at onboarding.
    timezone: text("timezone").notNull().default("UTC"),
    defaultTaskPriority: taskPriorityEnum("default_task_priority").notNull().default("NONE"),
    startOfDay: time("start_of_day").notNull().default("06:00:00"),
    weekStart: smallint("week_start").notNull().default(1),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    // Written by feature 04. No foreign key yet because `tasks` arrives in feature 02.
    focusTaskId: uuid("focus_task_id"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("user_preferences_week_start_range", sql`${t.weekStart} between 0 and 6`)],
);

export type UserPreferences = typeof userPreferences.$inferSelect;
