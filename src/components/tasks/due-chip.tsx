import { Clock } from "lucide-react";
import { formatDueLabel, isOverdue, type DayPrefs } from "@/lib/dates/today";
import { cn } from "@/lib/utils";

type Props = {
  dueDate: string;
  dueTime: string | null;
  status: string;
  prefs: DayPrefs;
  nowMs: number;
  className?: string;
};

/** Mono date or time. Overdue is red *with a clock icon and the date*, never color alone. */
export function DueChip({ dueDate, dueTime, status, prefs, nowMs, className }: Props) {
  const now = new Date(nowMs);
  const overdue = isOverdue({ status, dueDate, dueTime }, prefs, now);
  const label = formatDueLabel({ dueDate, dueTime }, prefs, now);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 type-data-sm",
        overdue ? "bg-destructive-subtle text-destructive" : "bg-secondary text-muted-foreground",
        className,
      )}
    >
      {overdue ? <Clock className="size-3" strokeWidth={1.5} aria-hidden /> : null}
      <span>{label}</span>
      {overdue ? <span className="sr-only"> (overdue)</span> : null}
    </span>
  );
}
