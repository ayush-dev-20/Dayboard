import { createHash } from "node:crypto";
import type { NotificationCategory } from "./categories";

// What a notification carries (V2 feature 14 §4, §7). The browser decrypts it, so it is small, holds no note text,
// and with "Show task titles" off holds no task title either.

export type PushPayload = {
  category: NotificationCategory;
  title: string;
  body: string;
  /** Where Open goes. A same-origin path. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  reminderId?: string;
  /** Lets the Snooze action work without opening the app (signed, valid for an hour). */
  token?: string;
};

/** The push services allow about 4 KB; stay well inside it. */
export const MAX_PAYLOAD_BYTES = 2048;
const MAX_TITLE = 120;

function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

export function reminderPayload(input: {
  taskId: string;
  taskTitle: string;
  showTitles: boolean;
  /** "Due at 14:30" or "Starts at 14:30"; with titles off, never repeated. */
  when: string;
  reminderId: string;
  token: string;
  calendar?: boolean;
}): PushPayload {
  return {
    category: input.calendar ? "CALENDAR_REMINDER" : "TASK_REMINDER",
    title: input.showTitles ? clip(input.taskTitle, MAX_TITLE) : "A task is due soon",
    body: input.showTitles ? input.when : "Open Dayboard to see it.",
    url: `/tasks?task=${input.taskId}`,
    tag: `reminder-${input.reminderId}`,
    reminderId: input.reminderId,
    token: input.token,
  };
}

export function overdueSummaryPayload(input: {
  overdue: number;
  dueToday: number;
  date: string;
  showTitles: boolean;
}): PushPayload {
  const parts: string[] = [];
  if (input.overdue > 0) parts.push(`${input.overdue} overdue`);
  if (input.dueToday > 0) parts.push(`${input.dueToday} due today`);
  return {
    category: "OVERDUE_SUMMARY",
    title: "Your day",
    // Counts, never titles: nothing private on a lock screen even with titles on.
    body: parts.join(", "),
    url: "/today",
    tag: `overdue-${input.date}`,
  };
}

export function weeklyReviewPayload(reviewId: string): PushPayload {
  return {
    category: "WEEKLY_REVIEW_READY",
    title: "Your weekly review is ready",
    body: "A look back at your week.",
    url: "/review",
    tag: `review-${reviewId}`,
  };
}

export function syncFailurePayload(): PushPayload {
  return {
    category: "SYNC_FAILURE",
    title: "Some changes weren't saved",
    body: "Open Dayboard to see what needs attention.",
    url: "/today",
    tag: "sync-failure",
  };
}

export function testPayload(): PushPayload {
  return {
    category: "TASK_REMINDER",
    title: "Notifications work",
    body: "This device will get your reminders.",
    url: "/settings/notifications",
    tag: "test",
  };
}

/** The payload as the bytes that are sent. Throws if it would not fit, so a bug is loud, not a silent drop. */
export function serializePayload(payload: PushPayload): string {
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).length > MAX_PAYLOAD_BYTES) {
    // The title is the only part that can be long; cut it to nothing rather than fail a reminder.
    return JSON.stringify({
      ...payload,
      title: clip(payload.title, 40),
      body: clip(payload.body, 80),
    });
  }
  return json;
}

/** How long a push service should keep trying (seconds): as long as the notification is still useful. */
export function ttlSeconds(category: NotificationCategory): number {
  return category === "OVERDUE_SUMMARY" ? 6 * 3600 : 3600;
}

/** A push topic is at most 32 URL-safe characters; a hash of the tag always fits and still collapses duplicates. */
export function topicOf(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 22);
}
