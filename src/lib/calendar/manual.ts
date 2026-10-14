import "server-only";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarAccounts, jobs } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { syncAccount, type SyncOutcome } from "./sync";

// "Sync now" (V2 feature 12 §8): runs the sync inline, so the person sees the result at once even where jobs only
// run on a tick. Limited to six a hour. Each run leaves a small finished record, which is what the limit counts.

export const MANUAL_SYNCS_PER_HOUR = 6;

export async function manualSync(userId: string, now: Date = new Date()): Promise<SyncOutcome[]> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [recent] = await db
    .select({ n: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, "calendar.manual_sync"),
        gt(jobs.createdAt, hourAgo),
      ),
    );
  if ((recent?.n ?? 0) >= MANUAL_SYNCS_PER_HOUR) {
    throw new AppError("RATE_LIMITED", "You've synced a lot just now. Try again in a while.", {
      retryAfterSeconds: 600,
    });
  }
  await db.insert(jobs).values({
    type: "calendar.manual_sync",
    payload: {},
    userId,
    status: "SUCCEEDED",
    attempts: 1,
    startedAt: now,
    finishedAt: now,
  });

  const accounts = await db
    .select({ id: calendarAccounts.id })
    .from(calendarAccounts)
    .where(and(eq(calendarAccounts.userId, userId), eq(calendarAccounts.status, "ACTIVE")));
  const outcomes: SyncOutcome[] = [];
  for (const account of accounts) outcomes.push(await syncAccount(account.id, now));
  return outcomes;
}
