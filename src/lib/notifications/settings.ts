import "server-only";
import { eq } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { notificationPreferences, userPreferences } from "@/db/schema";
import {
  CATEGORY_DEFAULTS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./categories";
import { quietHoursOf, type QuietHours } from "./quiet-hours";

// A person's notification settings as the rest of the code reads them (V2 feature 14 §2): the switch per category
// (the defaults where they have not chosen), quiet hours, the default lead, titles on or off, and the zone and day
// start the times are worked out in.

export type NotificationSettings = {
  categories: Record<NotificationCategory, boolean>;
  quiet: QuietHours | null;
  leadMinutes: number;
  showTitles: boolean;
  timezone: string;
  startOfDay: string;
};

export async function loadNotificationSettings(
  executor: Executor,
  userId: string,
): Promise<NotificationSettings> {
  const [prefs] = await executor
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const rows = await executor
    .select({
      category: notificationPreferences.category,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const categories = { ...CATEGORY_DEFAULTS };
  for (const row of rows) {
    if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(row.category)) {
      categories[row.category as NotificationCategory] = row.enabled;
    }
  }
  return {
    categories,
    quiet: quietHoursOf(prefs?.quietHoursStart, prefs?.quietHoursEnd),
    leadMinutes: prefs?.defaultReminderLeadMinutes ?? 15,
    showTitles: prefs?.notifyShowTitles ?? true,
    timezone: prefs?.timezone ?? "UTC",
    startOfDay: prefs?.startOfDay ?? "06:00:00",
  };
}
