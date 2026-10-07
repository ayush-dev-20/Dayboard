import "server-only";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import { getPreferences } from "@/lib/preferences";
import type { TaskContextValue } from "@/components/tasks/task-context";

/** Everything the task screens need to show dates in the person's own time zone. */
export async function loadTaskContext(userId: string): Promise<{
  dayPrefs: DayPrefs;
  now: Date;
  weekStart: number;
  aiEnabled: boolean;
  context: TaskContextValue;
}> {
  const prefs = await getPreferences(userId);
  const dayPrefs: DayPrefs = { timezone: prefs.timezone, startOfDay: prefs.startOfDay.slice(0, 5) };
  const now = new Date();
  return {
    dayPrefs,
    now,
    weekStart: prefs.weekStart,
    aiEnabled: prefs.aiEnabled,
    context: { prefs: dayPrefs, nowMs: now.getTime(), today: getUserToday(dayPrefs, now) },
  };
}
