import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inboxItems, tasks } from "@/db/schema";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import { OPEN_STATUSES } from "@/lib/tasks/status";

export type NavCounts = { today: number; inbox: number };

/**
 * The small numbers beside Today and Inbox in the sidebar: open tasks due today or overdue, and
 * open inbox items. Two cheap counts, run once per page by the app layout.
 */
export async function getNavCounts(
  userId: string,
  prefs: DayPrefs,
  now: Date = new Date(),
): Promise<NavCounts> {
  const today = getUserToday(prefs, now);
  const [due, inbox] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.parentTaskId),
          inArray(tasks.status, [...OPEN_STATUSES]),
          lte(tasks.dueDate, today),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.deletedAt),
          eq(inboxItems.status, "OPEN"),
        ),
      ),
  ]);
  return { today: due[0]?.n ?? 0, inbox: inbox[0]?.n ?? 0 };
}
