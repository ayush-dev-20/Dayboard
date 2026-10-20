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
import { tasks } from "./tasks";

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
    // V2 feature 11 §6A: the floating chat button. On by default; off hides only the button.
    assistantLauncher: boolean("assistant_launcher").notNull().default(true),
    // V2 feature 10: meaning-based search. Off by default, because turning it on sends the person's notes
    // and tasks to the embedding provider to build the index.
    semanticSearchEnabled: boolean("semantic_search_enabled").notNull().default(false),
    // V2 feature 13: the microphone button and the voice captures list. On by default; it only shows when
    // AI is available, because a recording is sent to the AI provider to be transcribed.
    voiceCaptureEnabled: boolean("voice_capture_enabled").notNull().default(true),
    // V2 feature 15: the weekly review. On by default (it works without AI, as facts only). `day` is 0 (Sunday) to 6,
    // null for the last day of the person's week; `hour` is local.
    weeklyReviewEnabled: boolean("weekly_review_enabled").notNull().default(true),
    weeklyReviewDay: smallint("weekly_review_day"),
    weeklyReviewHour: smallint("weekly_review_hour").notNull().default(17),
    // V2 feature 12: working hours, for free-slot suggestions and planning; and whether planning may see event
    // titles (off: it only sees when the person is busy).
    workStart: time("work_start").notNull().default("09:00:00"),
    workEnd: time("work_end").notNull().default("18:00:00"),
    planningSeesTitles: boolean("planning_sees_titles").notNull().default(false),
    // V2 feature 14: quiet hours (local time; both set, or neither), the default reminder lead for a task with a
    // time, and whether a notification shows the task's title (off: a generic line, nothing private on a lock screen).
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    defaultReminderLeadMinutes: smallint("default_reminder_lead_minutes").notNull().default(15),
    notifyShowTitles: boolean("notify_show_titles").notNull().default(true),
    // Today's focus (feature 04). Cleared if the task is permanently deleted.
    focusTaskId: uuid("focus_task_id").references(() => tasks.id, { onDelete: "set null" }),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    // The getting-started checklist on Today (feature 07 §9.6): hidden once dismissed.
    checklistDismissedAt: timestamp("checklist_dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("user_preferences_week_start_range", sql`${t.weekStart} between 0 and 6`),
    check(
      "user_preferences_review_day_range",
      sql`${t.weeklyReviewDay} is null or ${t.weeklyReviewDay} between 0 and 6`,
    ),
    check("user_preferences_review_hour_range", sql`${t.weeklyReviewHour} between 0 and 23`),
    check(
      "user_preferences_quiet_hours_pair",
      sql`(${t.quietHoursStart} is null) = (${t.quietHoursEnd} is null)`,
    ),
    check(
      "user_preferences_reminder_lead_range",
      sql`${t.defaultReminderLeadMinutes} between 0 and 1440`,
    ),
  ],
);

export type UserPreferences = typeof userPreferences.$inferSelect;
