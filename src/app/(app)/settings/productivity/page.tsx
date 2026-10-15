import type { Metadata } from "next";
import { ProductivitySettings } from "@/components/settings/productivity-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { WeeklyReviewSettings } from "@/components/settings/weekly-review-settings";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Productivity" };

export default async function ProductivitySettingsPage() {
  const user = await requireUser({ redirect: true });
  const prefs = await getPreferences(user.id);

  return (
    <SettingsSection title="Productivity">
      <ProductivitySettings
        initial={{
          timezone: prefs.timezone,
          startOfDay: prefs.startOfDay.slice(0, 5),
          weekStart: prefs.weekStart,
          defaultTaskPriority: prefs.defaultTaskPriority,
          workStart: prefs.workStart.slice(0, 5),
          workEnd: prefs.workEnd.slice(0, 5),
        }}
        showWorkHours={env.calendarAvailable}
      />
      <WeeklyReviewSettings
        initial={{
          enabled: prefs.weeklyReviewEnabled,
          day: prefs.weeklyReviewDay,
          hour: prefs.weeklyReviewHour,
        }}
        aiOn={env.aiAvailable && prefs.aiEnabled}
      />
    </SettingsSection>
  );
}
