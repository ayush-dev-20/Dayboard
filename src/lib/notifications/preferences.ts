import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationPreferences, userPreferences } from "@/db/schema";
import type { NotificationCategory } from "./categories";
import { recomputeAllReminders } from "./reminders";

// Writing the notification settings (V2 feature 14 §2, §6). Anything that changes when a reminder fires, or whether
// one is made at all, brings the person's reminders in line right away.

export async function setCategoryEnabled(
  userId: string,
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(notificationPreferences)
      .values({ userId, category, enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.category],
        set: { enabled, updatedAt: new Date() },
      });
    // Reminders are made only for a category that is on, so a switch changes which ones exist.
    if (category === "TASK_REMINDER" || category === "CALENDAR_REMINDER") {
      await recomputeAllReminders(tx, userId);
    }
  });
}

export async function setQuietHours(
  userId: string,
  quiet: { start: string; end: string } | null,
): Promise<void> {
  await db
    .update(userPreferences)
    .set({
      quietHoursStart: quiet ? `${quiet.start}:00` : null,
      quietHoursEnd: quiet ? `${quiet.end}:00` : null,
    })
    .where(eq(userPreferences.userId, userId));
}

export async function setReminderDefaults(
  userId: string,
  values: { leadMinutes?: number; showTitles?: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(userPreferences)
      .set({
        ...(values.leadMinutes !== undefined
          ? { defaultReminderLeadMinutes: values.leadMinutes }
          : {}),
        ...(values.showTitles !== undefined ? { notifyShowTitles: values.showTitles } : {}),
      })
      .where(eq(userPreferences.userId, userId));
    if (values.leadMinutes !== undefined) await recomputeAllReminders(tx, userId);
  });
}
