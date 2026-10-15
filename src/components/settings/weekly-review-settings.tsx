"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./settings-ui";

type Values = {
  enabled: boolean;
  /** 0 (Sunday) to 6, or null for the last day of the person's week. */
  day: number | null;
  hour: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The weekly review's switch, day and hour (V2 feature 15 §6). It works without AI: AI adds suggestions. */
export function WeeklyReviewSettings({ initial, aiOn }: { initial: Values; aiOn: boolean }) {
  const [values, setValues] = useState(initial);

  async function change(patch: Partial<Values>) {
    const previous = values;
    setValues({ ...values, ...patch });
    const result = await updatePreferences({
      ...(patch.enabled !== undefined ? { weeklyReviewEnabled: patch.enabled } : {}),
      ...(patch.day !== undefined ? { weeklyReviewDay: patch.day } : {}),
      ...(patch.hour !== undefined ? { weeklyReviewHour: patch.hour } : {}),
    });
    if (!result.ok) {
      setValues(previous);
      toast.error(result.error.message);
    }
  }

  return (
    <section className="mt-6" aria-labelledby="weekly-review-heading">
      <h3 id="weekly-review-heading" className="type-label-caps text-muted-foreground">
        Weekly review
      </h3>
      <SettingsRow
        title="Make a weekly review"
        description={
          aiOn
            ? "A short look back at your week: what happened, counted from your own data, and a few suggestions. Made automatically at the end of your week."
            : "A short look back at your week, counted from your own data. With AI off there are no suggestions."
        }
      >
        <Switch
          checked={values.enabled}
          onCheckedChange={(enabled) => void change({ enabled })}
          aria-label="Make a weekly review"
        />
      </SettingsRow>
      {values.enabled ? (
        <>
          <SettingsRow title="Review day" description="Defaults to the last day of your week.">
            <NativeSelect
              appearance="inline"
              aria-label="Review day"
              value={values.day === null ? "default" : String(values.day)}
              onChange={(e) =>
                void change({ day: e.target.value === "default" ? null : Number(e.target.value) })
              }
            >
              <option value="default">Last day of my week</option>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </NativeSelect>
          </SettingsRow>
          <SettingsRow title="Review time" description="Your local time.">
            <NativeSelect
              appearance="inline"
              aria-label="Review time"
              value={String(values.hour)}
              onChange={(e) => void change({ hour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
          </SettingsRow>
        </>
      ) : null}
    </section>
  );
}
