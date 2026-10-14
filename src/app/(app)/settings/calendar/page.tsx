import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarSettings } from "@/components/settings/calendar-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { getStatus } from "@/lib/calendar/store";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Calendar" };

const OUTCOMES: Record<string, string> = {
  connected: "Google Calendar is connected.",
  denied: "You didn't allow access, so nothing was connected.",
  scopes: "Dayboard needs permission to read your events. Nothing was connected.",
  failed: "That connection didn't finish. Try again.",
};

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  // With no calendar set up on this server, the tab and this page do not exist.
  if (!env.calendarAvailable) notFound();
  const user = await requireUser({ redirect: true });
  const [status, prefs, { calendar }] = await Promise.all([
    getStatus(user.id),
    getPreferences(user.id),
    searchParams,
  ]);

  return (
    <SettingsSection title="Calendar">
      <CalendarSettings
        status={status}
        planningSeesTitles={prefs.planningSeesTitles}
        notice={calendar ? (OUTCOMES[calendar] ?? null) : null}
        mock={env.calendarProvider === "mock"}
      />
    </SettingsSection>
  );
}
