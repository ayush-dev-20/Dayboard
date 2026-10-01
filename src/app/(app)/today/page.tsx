import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { formatLongDate, greetingFor } from "@/lib/dates/greeting";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Today" };

// The full Today screen (focus, overdue, due today, notes) arrives with feature 04. For now this
// confirms the account, greeting and time zone all work end to end.
export default async function TodayPage() {
  const user = await requireUser({ redirect: true });
  const { timezone } = await getPreferences(user.id);
  const now = new Date();
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <div className="max-w-content">
      <header className="mb-10">
        <h1 className="type-display text-foreground">
          {greetingFor(now, timezone)}, {firstName}
        </h1>
        <p className="mt-2 type-body-lg text-muted-foreground">{formatLongDate(now, timezone)}</p>
      </header>

      <EmptyState
        title="Your day is clear"
        description="Tasks, notes and your daily focus will show up here as those parts of Dayboard arrive."
      />
    </div>
  );
}
