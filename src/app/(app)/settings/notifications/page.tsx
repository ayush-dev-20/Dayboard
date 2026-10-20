import type { Metadata } from "next";
import { NotificationsSettings } from "@/components/settings/notifications-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { workerStatus } from "@/lib/jobs/maintenance";
import { env } from "@/lib/env";
import { loadNotificationSettings } from "@/lib/notifications/settings";
import { listSubscriptions } from "@/lib/notifications/subscriptions";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { db } from "@/db/client";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsSettingsPage() {
  const user = await requireUser({ redirect: true });
  const [settings, devices, prefs, worker] = await Promise.all([
    loadNotificationSettings(db, user.id),
    listSubscriptions(user.id),
    getPreferences(user.id),
    workerStatus().catch(() => "none" as const),
  ]);

  return (
    <SettingsSection title="Notifications">
      <NotificationsSettings
        serverAvailable={env.pushAvailable}
        categories={settings.categories}
        showWeeklyReview={prefs.weeklyReviewEnabled}
        quiet={settings.quiet}
        leadMinutes={settings.leadMinutes}
        showTitles={settings.showTitles}
        timeZone={settings.timezone}
        initialDevices={devices}
        // With no worker running, jobs run from a scheduled call every few minutes: reminders are approximate.
        approximate={worker !== "ok"}
      />
    </SettingsSection>
  );
}
