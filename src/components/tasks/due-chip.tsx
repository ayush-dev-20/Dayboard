import { Clock } from "lucide-react";
import { lateDescription, lateLabel, daysLate } from "@/lib/dates/relative";
import { formatDueLabel, getUserToday, isOverdue, type DayPrefs } from "@/lib/dates/today";
import { cn } from "@/lib/utils";

type Props = {
  dueDate: string;
  dueTime: string | null;
  status: string;
  prefs: DayPrefs;
  nowMs: number;
  /**
   * The one overdue item in its section that gets the filled red chip (the oldest). Every other
   * overdue row is red text, so a list of late things doesn't read as an alarm (DESIGN.md: red is rare).
   */
  emphasis?: boolean;
  className?: string;
};

/**
 * A due date. Overdue is never color alone: a clock icon, a relative label ("3d late") and, for
 * screen readers, the full meaning ("3 days late, due Sep 29 (overdue)").
 */
export function DueChip({ dueDate, dueTime, status, prefs, nowMs, emphasis, className }: Props) {
  const now = new Date(nowMs);
  const overdue = isOverdue({ status, dueDate, dueTime }, prefs, now);
  const label = formatDueLabel({ dueDate, dueTime }, prefs, now);

  if (!overdue) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-sm bg-secondary px-1.5 py-0.5 type-data-sm text-muted-foreground",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  const days = daysLate(dueDate, getUserToday(prefs, now));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 type-data-sm text-destructive",
        emphasis && "rounded-sm bg-destructive-subtle px-1.5 py-0.5",
        className,
      )}
    >
      <Clock className="size-3" strokeWidth={1.5} aria-hidden />
      <span aria-hidden>{lateLabel(days, label)}</span>
      <span className="sr-only">{lateDescription(days, label)} (overdue)</span>
    </span>
  );
}
