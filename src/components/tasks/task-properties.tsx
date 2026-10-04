"use client";

import { Calendar, ChevronDown, Folder, Repeat, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPickerDay, parseDateString } from "@/lib/dates/calendar";
import { nextMondayOf, tomorrowOf } from "@/lib/dates/today";
import {
  describeRule,
  describeRuleShort,
  MAX_INTERVAL,
  parseRule,
  presetOf,
  serializeRule,
  weekdayOf,
  WEEKDAYS,
  type RepeatPreset,
  type Weekday,
} from "@/lib/tasks/recurrence";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { ProjectPicker } from "@/components/workspace/project-picker";
import type { ProjectRef } from "@/lib/projects/dto";
import { PriorityGlyph } from "./priority-glyph";
import { useTaskContext } from "./task-context";

type TriggerProps = React.ComponentProps<"button"> & {
  label: string;
  value: string;
  icon?: LucideIcon;
};

// A quiet picker button: "Status  In progress ⌄". The value is semibold, the label is not.
export function PropertyTrigger({ label, value, icon: Icon, className, ...props }: TriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-11 items-center gap-1 rounded-md px-1.5 type-body-md text-muted-foreground md:h-8",
        "hover:bg-accent hover:text-foreground disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-4" strokeWidth={1.5} aria-hidden /> : null}
      <span>{label}</span>
      <b className="font-semibold text-foreground">{value}</b>
      <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

export function StatusPicker({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (v: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PropertyTrigger label="Status" value={STATUS_LABELS[value]} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as TaskStatus)}>
          {TASK_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (v: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PropertyTrigger label="Priority" value={PRIORITY_LABELS[value]} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as TaskPriority)}>
          {TASK_PRIORITIES.map((priority) => (
            <DropdownMenuRadioItem key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
              <span className="ml-auto">
                <PriorityGlyph priority={priority} />
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type DatePickerProps = {
  /** "Due" or "Start". */
  label: string;
  date: string | null;
  time: string | null;
  onChange: (next: { date: string | null; time: string | null }) => void;
};

/** A date, an optional time, and quick picks. Native inputs: accessible, and the right keyboard on phones. */
export function DatePicker({ label, date, time, onChange }: DatePickerProps) {
  const { prefs, nowMs, today } = useTaskContext();
  const now = new Date(nowMs);
  const value = date ? `${formatPickerDay(date)}${time ? ` · ${time}` : ""}` : "None";
  const key = label.toLowerCase();

  const quick = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: tomorrowOf(prefs, now) },
    { label: "Next Monday", date: nextMondayOf(prefs, now) },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <PropertyTrigger icon={Calendar} label={label} value={value} />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-wrap gap-1">
          {quick.map((q) => (
            <PopoverClose key={q.label} asChild>
              <Button variant="secondary" onClick={() => onChange({ date: q.date, time })}>
                {q.label}
              </Button>
            </PopoverClose>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor={`${key}-date`}>{label} date</Label>
          <Input
            id={`${key}-date`}
            type="date"
            value={date ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next === "") onChange({ date: null, time: null });
              else if (parseDateString(next)) onChange({ date: next, time });
            }}
          />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor={`${key}-time`}>{label} time (optional)</Label>
          <Input
            id={`${key}-time`}
            type="time"
            value={time ?? ""}
            disabled={!date}
            onChange={(e) => onChange({ date, time: e.target.value || null })}
          />
          {!date ? (
            <p className="type-body-sm text-muted-foreground">Choose a date first.</p>
          ) : null}
        </div>

        {date ? (
          <PopoverClose asChild>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => onChange({ date: null, time: null })}
            >
              Clear {key} date
            </Button>
          </PopoverClose>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const WEEKDAY_LETTERS: Record<Weekday, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
};
const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

type RepeatPickerProps = {
  rule: string | null;
  dueDate: string | null;
  onChange: (rule: string | null) => void;
};

/** Never, Daily, Weekdays, Weekly (choose days), Every N weeks, Monthly, Yearly. Needs a due date. */
export function RepeatPicker({ rule, dueDate, onChange }: RepeatPickerProps) {
  const preset = presetOf(rule);
  const parsed = rule ? parseRule(rule) : null;
  const disabled = !dueDate;

  const anchorDay = dueDate ? weekdayOf(dueDate) : "MO";
  const monthDay = dueDate ? (parseDateString(dueDate)?.d ?? 1) : 1;
  const chosenDays: Weekday[] = parsed?.freq === "WEEKLY" ? parsed.days : [anchorDay];
  const interval = parsed?.freq === "WEEKLY" ? parsed.interval : 2;

  function choose(next: RepeatPreset) {
    switch (next) {
      case "never":
        return onChange(null);
      case "daily":
        return onChange(serializeRule({ freq: "DAILY", interval: 1 }));
      case "weekdays":
        return onChange(
          serializeRule({ freq: "WEEKLY", days: ["MO", "TU", "WE", "TH", "FR"], interval: 1 }),
        );
      case "weekly":
        return onChange(serializeRule({ freq: "WEEKLY", days: chosenDays, interval: 1 }));
      case "every-n-weeks":
        return onChange(serializeRule({ freq: "WEEKLY", days: chosenDays, interval }));
      case "monthly":
        return onChange(serializeRule({ freq: "MONTHLY", monthDay }));
      case "yearly":
        return onChange(serializeRule({ freq: "YEARLY" }));
    }
  }

  function toggleDay(day: Weekday) {
    const next = chosenDays.includes(day)
      ? chosenDays.filter((d) => d !== day)
      : [...chosenDays, day];
    if (next.length === 0) return; // at least one day stays chosen
    onChange(
      serializeRule({
        freq: "WEEKLY",
        days: next,
        interval: parsed?.freq === "WEEKLY" ? parsed.interval : 1,
      }),
    );
  }

  const rows: { preset: RepeatPreset; label: string; detail?: string }[] = [
    { preset: "never", label: "Never" },
    { preset: "daily", label: "Daily" },
    { preset: "weekdays", label: "Weekdays" },
    {
      preset: "weekly",
      label: "Weekly",
      detail: preset === "weekly" ? describeRule(rule).replace("Weekly ", "") : undefined,
    },
    {
      preset: "every-n-weeks",
      label: `Every ${preset === "every-n-weeks" ? interval : 2} weeks`,
      detail: "interval 1–30",
    },
    { preset: "monthly", label: "Monthly", detail: `on day ${monthDay}` },
    { preset: "yearly", label: "Yearly" },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <PropertyTrigger icon={Repeat} label="Repeat" value={describeRuleShort(rule)} />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1">
        <div role="radiogroup" aria-label="Repeat">
          {rows.map((row) => {
            const selected = preset === row.preset;
            return (
              <div key={row.preset}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled && row.preset !== "never"}
                  onClick={() => choose(row.preset)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-1 text-left type-body-md md:min-h-8",
                    "hover:bg-accent disabled:opacity-60",
                    selected && "bg-primary-subtle",
                  )}
                >
                  <span className={cn(selected && "font-semibold")}>{row.label}</span>
                  {row.detail ? (
                    <span className="type-body-sm text-muted-foreground">{row.detail}</span>
                  ) : null}
                </button>

                {selected && (row.preset === "weekly" || row.preset === "every-n-weeks") ? (
                  <div className="flex flex-col gap-2 px-3 pb-2">
                    <div role="group" aria-label="Days of the week" className="flex gap-1">
                      {WEEKDAYS.map((day) => (
                        <button
                          key={day}
                          type="button"
                          aria-label={WEEKDAY_NAMES[day]}
                          aria-pressed={chosenDays.includes(day)}
                          onClick={() => toggleDay(day)}
                          className={cn(
                            "inline-flex size-9 items-center justify-center rounded-sm border type-data-md md:size-8",
                            chosenDays.includes(day)
                              ? "border-primary bg-primary-subtle text-primary"
                              : "border-input text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {WEEKDAY_LETTERS[day]}
                        </button>
                      ))}
                    </div>
                    {row.preset === "every-n-weeks" ? (
                      <div className="flex items-center gap-2">
                        <Label htmlFor="repeat-interval">Every</Label>
                        <Input
                          id="repeat-interval"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_INTERVAL}
                          value={interval}
                          onChange={(e) => {
                            const n = Math.min(
                              MAX_INTERVAL,
                              Math.max(1, Math.round(Number(e.target.value) || 1)),
                            );
                            onChange(
                              serializeRule({ freq: "WEEKLY", days: chosenDays, interval: n }),
                            );
                          }}
                          className="w-20"
                        />
                        <span className="type-body-md">weeks (1–{MAX_INTERVAL})</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-1 border-t border-border px-3 pt-3 pb-2 type-body-sm text-muted-foreground">
          {disabled
            ? "Choose a due date first. A repeating task needs one."
            : "A repeating task needs a due date. The next one appears when you complete this one."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** The task's project. Always optional: "No project" is one click away. */
export function ProjectPickerControl({
  value,
  onChange,
  disabled,
  allowCreate,
}: {
  value: ProjectRef | null;
  onChange: (projectId: string | null) => void | Promise<void>;
  disabled?: boolean;
  allowCreate?: boolean;
}) {
  return (
    <ProjectPicker value={value} onChange={onChange} allowCreate={allowCreate}>
      <PropertyTrigger
        icon={Folder}
        label="Project"
        value={value?.name ?? "None"}
        disabled={disabled}
        title={disabled ? "A subtask stays in its task's project" : undefined}
      />
    </ProjectPicker>
  );
}
