// The notification categories (V2 feature 14 §2, §7). The list is exhaustive on purpose: there are no notifications
// for growth, tips or promotions. Shared by the schema, the server and the settings page, so it imports nothing.

export const NOTIFICATION_CATEGORIES = [
  "TASK_REMINDER",
  "CALENDAR_REMINDER",
  "SYNC_FAILURE",
  "WEEKLY_REVIEW_READY",
  "OVERDUE_SUMMARY",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** On unless the person turns them off; the overdue summary is on only when they ask for it. */
export const CATEGORY_DEFAULTS: Record<NotificationCategory, boolean> = {
  TASK_REMINDER: true,
  CALENDAR_REMINDER: true,
  SYNC_FAILURE: true,
  WEEKLY_REVIEW_READY: true,
  OVERDUE_SUMMARY: false,
};

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; description: string }> =
  {
    TASK_REMINDER: {
      label: "Task reminders",
      description: "A tap on the shoulder before a task with a time is due.",
    },
    CALENDAR_REMINDER: {
      label: "Calendar-related reminders",
      description: "Before the event a task is linked to starts.",
    },
    SYNC_FAILURE: {
      label: "Sync problems",
      description: "When changes on this device could not be saved.",
    },
    WEEKLY_REVIEW_READY: {
      label: "Weekly review",
      description: "When your weekly review is ready to read.",
    },
    OVERDUE_SUMMARY: {
      label: "Overdue summary",
      description: "One note at the start of your day when something is overdue or due today.",
    },
  };

export const REMINDER_KINDS = ["DEFAULT_LEAD", "CUSTOM", "CALENDAR_START"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ["PENDING", "SENT", "SNOOZED", "CANCELLED"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const LOG_STATUSES = [
  "SENT",
  "FAILED",
  "SUPPRESSED_QUIET",
  "SUPPRESSED_PREF",
  // Added to the spec's list: the app was open on every device, so the in-app reminder stood in for the push.
  "SUPPRESSED_OPEN",
  "EXPIRED",
] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

/** A task has at most this many custom reminders (spec §3). */
export const MAX_CUSTOM_REMINDERS = 3;
