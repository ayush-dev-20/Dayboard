"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { getTaskReminders, setTaskReminders } from "@/actions/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_CUSTOM_REMINDERS } from "@/lib/notifications/categories";
import type { ReminderSpec } from "@/lib/notifications/remind-at";
import type { ReminderDTO } from "@/lib/notifications/reminders";
import { cn } from "@/lib/utils";

type Props = {
  taskId: string;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
  /** Reminders come and go with these, so the list is read again after they change. */
  closed: boolean;
};

/**
 * "Remind me" on a task (V2 feature 14 §3, §5): the reminders waiting on it as chips, and a way to add up to three
 * of your own. The default reminder (for a task with a time) is shown but not removed here: it is a setting.
 */
export function RemindMe({ taskId, dueDate, dueTime, startDate, startTime, closed }: Props) {
  const [reminders, setReminders] = useState<ReminderDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [exactDate, setExactDate] = useState("");
  const [exactTime, setExactTime] = useState("09:00");
  const hasTime = Boolean(dueTime || startTime);
  const hasDate = Boolean(dueDate || startDate);
  const custom = reminders.filter((r) => r.kind === "CUSTOM");

  const load = useCallback(async () => {
    const result = await getTaskReminders({ taskId });
    if (result.ok) setReminders(result.data);
  }, [taskId]);

  // The reminders follow the task's date and time on the server; look again shortly after they change.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 400);
    return () => clearTimeout(timer);
  }, [load, dueDate, dueTime, startDate, startTime, closed]);

  async function save(specs: ReminderSpec[]): Promise<boolean> {
    setBusy(true);
    const result = await setTaskReminders({ taskId, reminders: specs });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    setReminders(result.data);
    return true;
  }

  const customSpecs = custom.map((r) => r.spec);
  const add = (spec: ReminderSpec) => save([...customSpecs, spec]);
  const remove = (id: string) => save(custom.filter((r) => r.id !== id).map((r) => r.spec));

  if (closed) return null;

  const options: { label: string; spec: ReminderSpec; needs: "time" | "date" }[] = [
    { label: "At the time", spec: { type: "at" }, needs: "time" },
    { label: "5 minutes before", spec: { type: "before", minutes: 5 }, needs: "time" },
    { label: "15 minutes before", spec: { type: "before", minutes: 15 }, needs: "time" },
    { label: "30 minutes before", spec: { type: "before", minutes: 30 }, needs: "time" },
    { label: "1 hour before", spec: { type: "before", minutes: 60 }, needs: "time" },
    {
      label: "The evening before (18:00)",
      spec: { type: "day-before", time: "18:00" },
      needs: "date",
    },
    { label: "The day before (09:00)", spec: { type: "day-before", time: "09:00" }, needs: "date" },
  ];
  const full = custom.length >= MAX_CUSTOM_REMINDERS;

  return (
    <div className="-ml-1.5 flex flex-wrap items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-1 rounded-md px-1.5 type-body-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-8"
          >
            <Bell className="size-4" strokeWidth={1.5} aria-hidden />
            <span>Remind me</span>
            {reminders.length === 0 ? <b className="font-semibold text-foreground">None</b> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          {!hasDate ? (
            <p className="type-body-sm text-muted-foreground">
              Give the task a due or start date first. Then you can be reminded the day before, or
              at a time you choose.
            </p>
          ) : null}
          <ul className="flex flex-col">
            {options.map((option) => {
              const disabled = busy || full || (option.needs === "time" ? !hasTime : !hasDate);
              return (
                <li key={option.label}>
                  <PopoverClose asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void add(option.spec)}
                      className="flex min-h-11 w-full items-center rounded-md px-2 text-left type-body-md text-foreground hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent md:min-h-8"
                    >
                      {option.label}
                    </button>
                  </PopoverClose>
                </li>
              );
            })}
          </ul>
          {hasDate && !hasTime ? (
            <p className="mt-1 px-2 type-body-sm text-muted-foreground">
              Add a time to the task to be reminded before it.
            </p>
          ) : null}
          <div className="mt-3 border-t border-border pt-3">
            <p className="type-body-md font-semibold text-foreground">At a date and time</p>
            <div className="mt-2 flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="remind-date">Date</Label>
                <Input
                  id="remind-date"
                  type="date"
                  value={exactDate}
                  onChange={(e) => setExactDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="remind-time">Time</Label>
                <Input
                  id="remind-time"
                  type="time"
                  value={exactTime}
                  onChange={(e) => setExactTime(e.target.value)}
                />
              </div>
            </div>
            <PopoverClose asChild>
              <Button
                variant="secondary"
                className="mt-2"
                disabled={busy || full || !exactDate || !exactTime}
                onClick={() => void add({ type: "exact", date: exactDate, time: exactTime })}
              >
                Add reminder
              </Button>
            </PopoverClose>
          </div>
          {full ? (
            <p className="mt-2 type-body-sm text-muted-foreground">
              A task can have {MAX_CUSTOM_REMINDERS} reminders of your own. Remove one to add
              another.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>

      <ul className="flex flex-wrap items-center gap-1" aria-label="Reminders on this task">
        {reminders.map((reminder) => (
          <li
            key={reminder.id}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full bg-secondary pr-1 pl-2.5 type-body-sm text-foreground",
              reminder.kind !== "CUSTOM" && "pr-2.5",
            )}
          >
            <span>
              {reminder.label}
              {reminder.kind === "DEFAULT_LEAD" ? (
                <span className="text-muted-foreground"> · default</span>
              ) : null}
              {reminder.snoozed ? <span className="text-muted-foreground"> · snoozed</span> : null}
            </span>
            {reminder.kind === "CUSTOM" ? (
              <button
                type="button"
                aria-label={`Remove reminder: ${reminder.label}`}
                disabled={busy}
                onClick={() => void remove(reminder.id)}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
