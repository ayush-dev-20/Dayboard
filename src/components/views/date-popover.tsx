"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTaskContext } from "@/components/tasks/task-context";
import { parseDateString } from "@/lib/dates/calendar";
import { nextMondayOf, tomorrowOf } from "@/lib/dates/today";

/**
 * Quick picks (Today, Tomorrow, Next Monday), a native date input, and a way to clear: the one date
 * control for table cells, bulk actions and the calendar's "Move to date". `children` is the button
 * that opens it.
 */
export function DatePopover({
  id,
  label,
  date,
  onPick,
  clearable = true,
  clearDisabledReason,
  children,
}: {
  /** Unique on the page: ties the date input to its label. */
  id: string;
  /** What the date is, for the label: "Due date". */
  label: string;
  date: string | null;
  onPick: (date: string | null) => void;
  clearable?: boolean;
  clearDisabledReason?: string;
  children: React.ReactNode;
}) {
  const { prefs, nowMs, today } = useTaskContext();
  const now = new Date(nowMs);
  const quick = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: tomorrowOf(prefs, now) },
    { label: "Next Monday", date: nextMondayOf(prefs, now) },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-wrap gap-1">
          {quick.map((q) => (
            <PopoverClose key={q.label} asChild>
              <Button variant="secondary" onClick={() => onPick(q.date)}>
                {q.label}
              </Button>
            </PopoverClose>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            type="date"
            value={date ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next && parseDateString(next)) onPick(next);
            }}
          />
        </div>
        {clearable && date ? (
          <PopoverClose asChild>
            <Button
              variant="ghost"
              className="mt-3"
              disabled={Boolean(clearDisabledReason)}
              title={clearDisabledReason}
              onClick={() => onPick(null)}
            >
              No date
            </Button>
          </PopoverClose>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
