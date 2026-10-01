"use client";

import { useMemo, useState, useTransition } from "react";
import { Calendar, Clock } from "lucide-react";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";
import { useIsClient } from "@/hooks/use-browser";
import { listTimeZones, timeZoneLabel } from "@/lib/dates/timezones";
import { SettingsRow } from "./settings-ui";

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH";

type Values = {
  timezone: string;
  /** "HH:MM" */
  startOfDay: string;
  weekStart: number;
  defaultTaskPriority: Priority;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];
// Half-hour steps from 00:00 to 23:30.
const START_TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 === 0 ? "00" : "30"}`;
});

export function ProductivitySettings({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [, startTransition] = useTransition();
  // The server renders just the saved zone; the full list is built in the browser after hydration.
  const isClient = useIsClient();
  const zones = useMemo(
    () =>
      isClient
        ? listTimeZones(values.timezone)
        : [{ value: values.timezone, label: timeZoneLabel(values.timezone) }],
    [isClient, values.timezone],
  );

  function change<K extends keyof Values>(key: K, value: Values[K]) {
    const previous = values[key];
    setValues((v) => ({ ...v, [key]: value }));
    startTransition(async () => {
      const result = await updatePreferences({ [key]: value });
      if (!result.ok) {
        setValues((v) => ({ ...v, [key]: previous }));
        toast.error(result.error.message);
        return;
      }
      toast("Saved");
    });
  }

  return (
    <>
      <SettingsRow
        title="Time zone"
        description="Used for Today, due dates and overdue."
        stackOnPhone
      >
        <NativeSelect
          appearance="inline"
          wrapperClassName="max-sm:block max-sm:w-full"
          className="max-sm:w-full"
          icon={Clock}
          aria-label="Time zone"
          value={values.timezone}
          onChange={(e) => change("timezone", e.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>

      <SettingsRow title="Start of day" description="Today rolls over at this local time.">
        <NativeSelect
          appearance="inline"
          icon={Clock}
          aria-label="Start of day"
          value={values.startOfDay}
          onChange={(e) => change("startOfDay", e.target.value)}
        >
          {START_TIMES.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>

      <SettingsRow title="Week starts on">
        <NativeSelect
          appearance="inline"
          icon={Calendar}
          aria-label="Week starts on"
          value={String(values.weekStart)}
          onChange={(e) => change("weekStart", Number(e.target.value))}
        >
          {WEEKDAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>

      <SettingsRow
        title="Default task priority"
        description="Applied to new tasks. You can change it per task."
      >
        <NativeSelect
          appearance="inline"
          aria-label="Default task priority"
          value={values.defaultTaskPriority}
          onChange={(e) => change("defaultTaskPriority", e.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>
    </>
  );
}
