import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { user } from "./auth";
import { tasks } from "./tasks";

// The weekly review (V2 feature 15 §2). `facts` is computed from the person's own data and never touched by a
// model; `suggestions` is validated AI output. Both hold titles and ids, never note bodies: private data, deleted
// with the account, never logged.

export const REVIEW_STATUSES = ["PENDING", "READY", "FAILED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const SUGGESTION_STATUSES = ["NONE", "GENERATED", "UNAVAILABLE", "OFF"] as const;
export type SuggestionsStatus = (typeof SUGGESTION_STATUSES)[number];

export const weeklyReviews = pgTable(
  "weekly_reviews",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The person's own calendar days (their week-start preference decides the first).
    weekStart: date("week_start", { mode: "string" }).notNull(),
    weekEnd: date("week_end", { mode: "string" }).notNull(),
    status: text("status").notNull().default("PENDING"),
    facts: jsonb("facts"),
    factsVersion: integer("facts_version").notNull().default(1),
    suggestions: jsonb("suggestions"),
    suggestionsStatus: text("suggestions_status").notNull().default("NONE"),
    // Why there are no suggestions: `AI_OFF`, `RATE_LIMITED` or `AI_PROVIDER_ERROR`. A plain code, never text.
    suggestionsError: text("suggestions_error"),
    // When suggestions were last made, for "once a day".
    suggestionsAt: timestamp("suggestions_at", { withTimezone: true }),
    // A "week so far" review made before the week's review day.
    partial: boolean("partial").notNull().default(false),
    model: text("model"),
    promptVersion: text("prompt_version"),
    // The carry-forward proposal was applied (once per review).
    carryAppliedAt: timestamp("carry_applied_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("weekly_reviews_user_week_idx").on(t.userId, t.weekStart),
    index("weekly_reviews_user_generated_idx").on(t.userId, t.weekStart.desc()),
    check("weekly_reviews_status", sql`${t.status} in ('PENDING','READY','FAILED')`),
    check(
      "weekly_reviews_suggestions_status",
      sql`${t.suggestionsStatus} in ('NONE','GENERATED','UNAVAILABLE','OFF')`,
    ),
    check("weekly_reviews_week_order", sql`${t.weekEnd} >= ${t.weekStart}`),
  ],
);

export const SCHEDULE_REASONS = [
  "MANUAL",
  "PLAN_DAY",
  "OVERDUE_CLEANUP",
  "BOARD_DRAG",
  "CALENDAR_DRAG",
  "REVIEW",
] as const;
export type ScheduleReason = (typeof SCHEDULE_REASONS)[number];

// Every time a task's due date changes (V2 feature 15 §2). V1 did not record this, so it starts when the feature
// ships (no backfill): a postponement is a change to a later date from a date that was set.
export const taskScheduleHistory = pgTable(
  "task_schedule_history",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fromDate: date("from_date", { mode: "string" }),
    toDate: date("to_date", { mode: "string" }),
    reason: text("reason").notNull().default("MANUAL"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_schedule_history_user_changed_idx").on(t.userId, t.changedAt.desc()),
    index("task_schedule_history_task_idx").on(t.taskId, t.changedAt),
    check(
      "task_schedule_history_reason",
      sql`${t.reason} in ('MANUAL','PLAN_DAY','OVERDUE_CLEANUP','BOARD_DRAG','CALENDAR_DRAG','REVIEW')`,
    ),
  ],
);

// When a thing began to be recorded, so "not enough history" can be told from "nothing happened". One row per
// name, written by the migration that introduces the thing.
export const featureEpochs = pgTable("feature_epochs", {
  name: text("name").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type NewWeeklyReview = typeof weeklyReviews.$inferInsert;
