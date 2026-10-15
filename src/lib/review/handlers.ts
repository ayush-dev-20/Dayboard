import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { taskScheduleHistory, userPreferences, weeklyReviews } from "@/db/schema";
import { dateSchema } from "@/lib/validations/tasks";
import { enqueue } from "@/lib/jobs/enqueue";
import { findHandler, registerHandler } from "@/lib/jobs/registry";
import { PermanentError } from "@/lib/jobs/types";
import { AppError } from "@/lib/errors";
import { generateReview, reviewPrefsOf } from "./service";
import { currentWeek, isReviewDue } from "./week";

// The weekly review's jobs (V2 feature 15 §3): an hourly scan that queues one `review.generate` per person whose
// review day and hour have come, the generation itself, and a daily prune of the schedule history. Every job is
// safe to run twice, takes the person from `ctx.userId`, and logs counts only.

/** Schedule history is kept this long (V2 feature 15 §2). */
export const HISTORY_RETENTION_DAYS = 365;

/** Queues the generation for one person's current week. A job already waiting or running is reused. */
export async function enqueueReview(userId: string, weekStart: string): Promise<string> {
  return enqueue(db, {
    type: "review.generate",
    payload: { weekStart },
    userId,
    queue: "ai",
    maxAttempts: 3,
    dedupeKey: `review.generate:${userId}:${weekStart}`,
  });
}

/**
 * One pass over everyone who has the review switched on: whoever is at or past their review day and hour, and has
 * no final review for the week yet, gets a `review.generate` job. Returns how many were queued.
 */
export async function scanForReviews(now: Date = new Date()): Promise<number> {
  const people = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.weeklyReviewEnabled, true));
  const due: { userId: string; weekStart: string }[] = [];
  for (const prefs of people) {
    const reviewPrefs = reviewPrefsOf(prefs);
    if (!isReviewDue(reviewPrefs, now)) continue;
    due.push({ userId: prefs.userId, weekStart: currentWeek(reviewPrefs, now).start });
  }
  if (due.length === 0) return 0;

  const done = await db
    .select({ userId: weeklyReviews.userId, weekStart: weeklyReviews.weekStart })
    .from(weeklyReviews)
    .where(
      and(
        inArray(
          weeklyReviews.userId,
          due.map((d) => d.userId),
        ),
        eq(weeklyReviews.partial, false),
        eq(weeklyReviews.status, "READY"),
      ),
    );
  const finished = new Set(done.map((d) => `${d.userId}:${d.weekStart}`));
  let queued = 0;
  for (const item of due) {
    if (finished.has(`${item.userId}:${item.weekStart}`)) continue;
    await enqueueReview(item.userId, item.weekStart);
    queued += 1;
  }
  return queued;
}

/** Removes schedule history older than a year. */
export async function pruneScheduleHistory(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 24 * 3_600_000);
  const removed = await db
    .delete(taskScheduleHistory)
    .where(lt(taskScheduleHistory.changedAt, cutoff))
    .returning({ id: taskScheduleHistory.id });
  return removed.length;
}

let registered = false;

/** Called by every entry point that runs jobs (through `ensureBuiltinHandlers`). */
export function ensureReviewHandlers(): void {
  if (registered) return;
  registered = true;

  if (!findHandler("review.scan")) {
    registerHandler({
      type: "review.scan",
      queue: "ai",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        const queued = await scanForReviews();
        ctx.log("review scan", { queued });
      },
    });
  }

  if (!findHandler("review.generate")) {
    registerHandler({
      type: "review.generate",
      queue: "ai",
      schema: z.object({ weekStart: dateSchema }).strict(),
      run: async (ctx, payload) => {
        if (!ctx.userId) throw new PermanentError("A review job needs a person.");
        const [prefs] = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.userId, ctx.userId));
        // Switched off since it was queued, or the week has moved on: nothing to do.
        if (!prefs?.weeklyReviewEnabled) return { outcome: "OFF" };
        let result;
        try {
          result = await generateReview(ctx.userId, {
            origin: "AUTO",
            weekStart: payload.weekStart,
          });
        } catch (error) {
          // The week is too old to make (the job sat for more than a week): nothing to do, and never retry.
          if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
            return { outcome: "STALE" };
          }
          throw error;
        }
        ctx.log("weekly review", { outcome: result.outcome });
        return { outcome: result.outcome };
      },
    });
  }

  if (!findHandler("review.prune_history")) {
    registerHandler({
      type: "review.prune_history",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        ctx.log("schedule history pruned", { removed: await pruneScheduleHistory() });
      },
    });
  }
}
