import { isOverdue, type DayPrefs } from "../dates/today";
import { trimTime } from "../dates/calendar";

type Dated = { id: string; status: string; dueDate: string | null; dueTime: string | null };

/**
 * "Red is rare" (feature 07 §5.3): in a section, only the single oldest overdue item gets the filled
 * red chip; the rest show red text. Returns that item's id, or null when nothing is overdue.
 * Ties go to the earlier time, then to list order.
 */
export function oldestOverdueId(
  items: readonly Dated[],
  prefs: DayPrefs,
  now: Date = new Date(),
): string | null {
  let best: Dated | null = null;
  for (const item of items) {
    if (!item.dueDate || !isOverdue(item, prefs, now)) continue;
    if (!best) {
      best = item;
      continue;
    }
    const a = `${item.dueDate} ${trimTime(item.dueTime) ?? "00:00"}`;
    const b = `${best.dueDate} ${trimTime(best.dueTime) ?? "00:00"}`;
    if (a < b) best = item;
  }
  return best?.id ?? null;
}
