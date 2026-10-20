import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { uuidv7 } from "../../lib/ids";
import {
  LOG_STATUSES,
  NOTIFICATION_CATEGORIES,
  REMINDER_KINDS,
  REMINDER_STATUSES,
} from "../../lib/notifications/categories";
import { user } from "./auth";
import { tasks } from "./tasks";

// Push notifications and reminders (V2 feature 14 §2, docs/decisions/0013). Categories, kinds and statuses are text
// with a check (like calendar and voice), so a new one is a one-line migration. Nothing here stores a title or body.

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Made by the browser on first use and kept there. One live subscription per person and device.
    deviceId: uuid("device_id").notNull(),
    // The push service's address. Unique across everyone: one browser profile never delivers to two people.
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgentLabel: text("user_agent_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // A heartbeat from an open, focused tab. Recent means "the app is open here": the in-app reminder replaces the push.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_user_device_live_idx")
      .on(t.userId, t.deviceId)
      .where(sql`${t.revokedAt} is null`),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.category] }),
    check(
      "notification_preferences_category",
      sql`${t.category} in (${list(NOTIFICATION_CATEGORIES)})`,
    ),
  ],
);

export const taskReminders = pgTable(
  "task_reminders",
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
    // The computed instant. Recomputed from `spec` whenever the task's date or time changes.
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    // How it was defined: `{ type: "before", minutes }`, `{ type: "at" }`, `{ type: "day-before", time }`, ...
    spec: jsonb("spec").notNull(),
    status: text("status").notNull().default("PENDING"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    // Added to the spec's columns: set when the person opens, dismisses or snoozes the in-app reminder.
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_reminders_status_remind_at_idx").on(t.status, t.remindAt),
    index("task_reminders_task_idx").on(t.taskId),
    // The default lead and the calendar one are one row each per task; custom reminders can be several.
    uniqueIndex("task_reminders_task_kind_idx")
      .on(t.taskId, t.kind)
      .where(sql`${t.kind} <> 'CUSTOM'`),
    check("task_reminders_kind", sql`${t.kind} in (${list(REMINDER_KINDS)})`),
    check("task_reminders_status", sql`${t.status} in (${list(REMINDER_STATUSES)})`),
  ],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    // What makes a delivery happen once: `reminder:<id>:<remind_at>`, `overdue:<date>`, `review:<id>`.
    dedupeKey: text("dedupe_key").notNull(),
    subscriptionId: uuid("subscription_id").references(() => pushSubscriptions.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    // A status code or a short word (`410`, `no_keys`). Never text from the notification.
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_log_user_dedupe_idx").on(t.userId, t.dedupeKey),
    index("notification_log_created_idx").on(t.createdAt),
    check("notification_log_category", sql`${t.category} in (${list(NOTIFICATION_CATEGORIES)})`),
    check("notification_log_status", sql`${t.status} in (${list(LOG_STATUSES)})`),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type TaskReminderRow = typeof taskReminders.$inferSelect;
