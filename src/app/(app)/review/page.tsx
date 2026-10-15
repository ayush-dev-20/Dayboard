import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/page-container";
import { WeeklyReview } from "@/components/review/weekly-review";
import { env } from "@/lib/env";
import { getUserToday } from "@/lib/dates/today";
import { getPreferences } from "@/lib/preferences";
import { getLatestReview, getReviewByWeek, listReviews, reviewPrefsOf } from "@/lib/review/service";
import { currentWeek, weekOf } from "@/lib/review/week";
import { requireUser } from "@/lib/session";
import { isValidDateString } from "@/lib/dates/calendar";

export const metadata: Metadata = { title: "Weekly review" };

// The weekly review (V2 feature 15 §6): the current week's review, or the one the person picked from the last
// twelve. The first day of the week is in the address (`?week=2026-10-12`), so it can be linked and reloaded.
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser({ redirect: true });
  const prefs = await getPreferences(user.id);
  const params = await searchParams;
  const reviewPrefs = reviewPrefsOf(prefs);
  const now = new Date();
  const current = currentWeek(reviewPrefs, now);
  const today = getUserToday(prefs, now);

  const history = await listReviews(user.id);
  const asked = params.week && isValidDateString(params.week) ? params.week : null;
  // With no week asked for, the current week's review if it exists, otherwise the latest there is.
  const review = asked
    ? await getReviewByWeek(user.id, asked)
    : ((await getReviewByWeek(user.id, current.start)) ?? (await getLatestReview(user.id)));
  const week = review
    ? { start: review.weekStart, end: review.weekEnd }
    : asked
      ? weekOf(asked, prefs.weekStart)
      : current;

  return (
    <PageContainer>
      <WeeklyReview
        // A new week is a new page of state.
        key={`${week.start}-${review?.id ?? "none"}`}
        initial={review}
        week={week}
        isCurrent={week.start === current.start}
        history={history}
        aiAvailable={env.aiAvailable && prefs.aiEnabled}
        today={today}
        current={current}
      />
    </PageContainer>
  );
}
