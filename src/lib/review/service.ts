import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { archiveTask, setTaskStatus, updateTask } from "@/db/mutations/tasks";
import { plainTasks } from "@/db/queries/task-filters";
import { auditLog, tasks, weeklyReviews, type WeeklyReview } from "@/db/schema";
import { generateStructured, getProvider, isAIAvailable, PROMPT_VERSIONS } from "@/lib/ai";
import { reviewFactsBlock, systemPrompts, todayLine } from "@/lib/ai/prompts";
import { reviewSuggestionsOutputSchema } from "@/lib/ai/schemas";
import { checkLimits } from "@/lib/ai/usage";
import { getUserToday, localDay } from "@/lib/dates/today";
import { AppError } from "@/lib/errors";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { logger } from "@/lib/logger";
import { getPreferences } from "@/lib/preferences";
import { buildFacts, weekHadActivity } from "./load";
import { relevantTasks, validateSuggestions } from "./suggestions";
import {
  type CarryUndo,
  type ReviewDTO,
  type ReviewFacts,
  type ReviewListItem,
  type ReviewSuggestions,
  type SuggestionsError,
  type SuggestionsState,
} from "./types";
import { addDays } from "@/lib/dates/calendar";
import { currentWeek, weekOf, type ReviewPrefs } from "./week";
import type { UserPreferences } from "@/db/schema";

// The weekly review (V2 feature 15): making one, adding suggestions, reading and dismissing, and applying the
// carry-forward proposal. Every function takes the person from the session or the job, and a review that is not
// theirs is `NOT_FOUND`. Nothing here ever logs a title or a suggestion.

export const reviewPrefsOf = (prefs: UserPreferences): ReviewPrefs => ({
  timezone: prefs.timezone,
  startOfDay: prefs.startOfDay,
  weekStart: prefs.weekStart,
  weeklyReviewDay: prefs.weeklyReviewDay,
  weeklyReviewHour: prefs.weeklyReviewHour,
});

const asFacts = (row: WeeklyReview) => (row.facts as ReviewFacts | null) ?? null;

/** Whether suggestions may be (re)generated now: never made, not made today, or not made at all. */
function canRegenerate(row: WeeklyReview, timezone: string, now: Date): boolean {
  if (row.suggestionsStatus !== "GENERATED") return false;
  if (!row.suggestionsAt) return true;
  return row.suggestionsAt < localDay(timezone, now).start;
}

export function toDTO(row: WeeklyReview, timezone: string, now: Date = new Date()): ReviewDTO {
  return {
    id: row.id,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    status: row.status as ReviewDTO["status"],
    partial: row.partial,
    facts: asFacts(row),
    suggestions: (row.suggestions as ReviewSuggestions | null) ?? null,
    suggestionsStatus: row.suggestionsStatus as SuggestionsState,
    suggestionsError: (row.suggestionsError as SuggestionsError) ?? null,
    canRegenerate: canRegenerate(row, timezone, now),
    carryApplied: row.carryAppliedAt !== null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    viewedAt: row.viewedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
  };
}

async function ownedRow(userId: string, id: string): Promise<WeeklyReview> {
  const [row] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.id, id), eq(weeklyReviews.userId, userId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * The suggestions step: AI off or unavailable is a facts-only review, not a failure. One AI action against the
 * V1 limits. The model's answer is validated against the facts, and what is invalid is dropped; if nothing is
 * left the suggestions are unavailable.
 */
async function produceSuggestions(
  userId: string,
  row: WeeklyReview,
  prefs: UserPreferences,
  now: Date,
): Promise<WeeklyReview> {
  const facts = asFacts(row);
  const set = async (patch: Partial<typeof weeklyReviews.$inferInsert>) => {
    const [updated] = await db
      .update(weeklyReviews)
      .set(patch)
      .where(eq(weeklyReviews.id, row.id))
      .returning();
    return updated ?? row;
  };
  if (!facts) return row;
  if (!isAIAvailable() || !prefs.aiEnabled) {
    return set({ suggestionsStatus: "OFF", suggestionsError: "AI_OFF", suggestions: null });
  }

  const provider = getProvider();
  try {
    await checkLimits(userId, prefs.timezone, {
      feature: "WEEKLY_REVIEW",
      provider: provider.id,
      model: provider.modelName("main"),
      promptVersion: PROMPT_VERSIONS.WEEKLY_REVIEW,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") {
      return set({
        suggestionsStatus: "UNAVAILABLE",
        suggestionsError: "RATE_LIMITED",
        suggestions: null,
      });
    }
    throw error;
  }

  const today = getUserToday(prefs, now);
  try {
    const output = await generateStructured({
      userId,
      feature: "WEEKLY_REVIEW",
      tier: "main",
      system: systemPrompts.WEEKLY_REVIEW,
      prompt: `${todayLine(today, prefs.timezone)}\n\n${reviewFactsBlock(factsForModel(facts), {
        workStart: prefs.workStart.slice(0, 5),
        workEnd: prefs.workEnd.slice(0, 5),
      })}`,
      schema: reviewSuggestionsOutputSchema,
      fixture: { facts, today },
    });
    const suggestions = validateSuggestions(output, facts, today);
    if (!suggestions) {
      return set({
        suggestionsStatus: "UNAVAILABLE",
        suggestionsError: "EMPTY",
        suggestions: null,
      });
    }
    return set({
      suggestions,
      suggestionsStatus: "GENERATED",
      suggestionsError: null,
      suggestionsAt: now,
      model: getProvider().modelName("main"),
      promptVersion: PROMPT_VERSIONS.WEEKLY_REVIEW,
      carryAppliedAt: null,
    });
  } catch (error) {
    // A provider failure leaves a facts-only review. Never the facts or the answer in the log.
    logger.warn("weekly review suggestions failed", {
      code: error instanceof AppError ? error.code : "UNKNOWN",
    });
    return set({
      suggestionsStatus: "UNAVAILABLE",
      suggestionsError: "AI_PROVIDER_ERROR",
      suggestions: null,
    });
  }
}

/** What the model is shown of the facts: counts and titles with ids, nothing that is not already in the review. */
function factsForModel(facts: ReviewFacts) {
  const { computedAt: _computedAt, version: _version, ...rest } = facts;
  void _computedAt;
  void _version;
  return rest;
}

export type GenerateOutcome = "CREATED" | "EXISTS" | "KEPT_FINAL" | "EMPTY";

/**
 * Makes (or refreshes) the review of the person's current week (V2 feature 15 §3).
 * - `AUTO` is the worker's end-of-week run: final (`partial = false`), replaces a "week so far", and does nothing if a
 *   final review already exists, so a double run is harmless. A week with nothing done and nothing written is not reviewed.
 * - `MANUAL` is "Generate now": a "week so far" (`partial = true`) that replaces the previous one. A final review is
 *   never replaced by a partial one.
 */
export async function generateReview(
  userId: string,
  options: { origin: "AUTO" | "MANUAL"; weekStart?: string | null; now?: Date },
): Promise<{ review: ReviewDTO | null; outcome: GenerateOutcome }> {
  const now = options.now ?? new Date();
  const prefs = await getPreferences(userId);
  const reviewPrefs = reviewPrefsOf(prefs);
  let week = currentWeek(reviewPrefs, now);
  if (options.weekStart && options.weekStart !== week.start) {
    // The worker may be late: a job queued on the last day of a week can run just after it ended, and that week's
    // review is still the one to make. Anything older, or any request from a person, is refused.
    const previous = weekOf(addDays(week.start, -1), prefs.weekStart);
    if (options.origin !== "AUTO" || options.weekStart !== previous.start) {
      throw new AppError("VALIDATION_ERROR", "Only the current week can be generated.");
    }
    week = previous;
  }

  const [existing] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, week.start)))
    .limit(1);
  if (existing && !existing.partial && existing.status === "READY") {
    return {
      review: toDTO(existing, prefs.timezone, now),
      outcome: options.origin === "AUTO" ? "EXISTS" : "KEPT_FINAL",
    };
  }

  const facts = await buildFacts(userId, week, prefs, now);
  if (!weekHadActivity(facts)) return { review: null, outcome: "EMPTY" };

  const values = {
    userId,
    weekStart: week.start,
    weekEnd: week.end,
    status: "READY",
    facts,
    factsVersion: facts.version,
    partial: options.origin === "MANUAL",
    suggestions: null,
    suggestionsStatus: "NONE",
    suggestionsError: null,
    suggestionsAt: null,
    model: null,
    promptVersion: null,
    carryAppliedAt: null,
    generatedAt: now,
    viewedAt: null,
    dismissedAt: null,
  };
  const [saved] = await db
    .insert(weeklyReviews)
    .values(values)
    .onConflictDoUpdate({
      target: [weeklyReviews.userId, weeklyReviews.weekStart],
      set: { ...values, updatedAt: now },
    })
    .returning();
  if (!saved) throw new AppError("INTERNAL_ERROR");

  const withSuggestions = await produceSuggestions(userId, saved, prefs, now);
  // A finished review tells the person once, if they asked to hear about it (V2 feature 14). A "week so far" never does.
  if (options.origin === "AUTO" && !saved.partial) {
    await enqueueNotification(db, {
      userId,
      category: "WEEKLY_REVIEW_READY",
      dedupeKey: `review:${saved.id}`,
      reviewId: saved.id,
    });
  }
  return { review: toDTO(withSuggestions, prefs.timezone, now), outcome: "CREATED" };
}

/**
 * "Add suggestions" (when there were none) and "Regenerate suggestions" (once a day). Facts are not recomputed:
 * the suggestions are about the facts the person is looking at.
 */
export async function addSuggestions(
  userId: string,
  weekStart: string,
  now: Date = new Date(),
): Promise<ReviewDTO> {
  const prefs = await getPreferences(userId);
  const [row] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)))
    .limit(1);
  if (!row || row.status !== "READY") throw new AppError("NOT_FOUND");
  if (!isAIAvailable() || !prefs.aiEnabled) throw new AppError("AI_DISABLED");
  if (row.suggestionsStatus === "GENERATED" && !canRegenerate(row, prefs.timezone, now)) {
    throw new AppError("RATE_LIMITED", "Suggestions can be regenerated once a day.", {
      retryAfterSeconds: 3600,
    });
  }
  const updated = await produceSuggestions(userId, row, prefs, now);
  return toDTO(updated, prefs.timezone, now);
}

export async function getReviewByWeek(
  userId: string,
  weekStart: string,
): Promise<ReviewDTO | null> {
  const prefs = await getPreferences(userId);
  const [row] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)))
    .limit(1);
  return row ? toDTO(row, prefs.timezone) : null;
}

/** The newest review (the current week's, or the latest that exists). */
export async function getLatestReview(userId: string): Promise<ReviewDTO | null> {
  const prefs = await getPreferences(userId);
  const [row] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.status, "READY")))
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(1);
  return row ? toDTO(row, prefs.timezone) : null;
}

/** The 12 most recent reviews, newest first. */
export async function listReviews(userId: string): Promise<ReviewListItem[]> {
  const rows = await db
    .select({
      id: weeklyReviews.id,
      weekStart: weeklyReviews.weekStart,
      weekEnd: weeklyReviews.weekEnd,
      partial: weeklyReviews.partial,
    })
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.status, "READY")))
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(12);
  return rows;
}

/** The review a Today card should offer: final, ready, not yet opened, never dismissed. */
export async function unreadReviewFor(userId: string): Promise<ReviewListItem | null> {
  const [row] = await db
    .select({
      id: weeklyReviews.id,
      weekStart: weeklyReviews.weekStart,
      weekEnd: weeklyReviews.weekEnd,
      partial: weeklyReviews.partial,
    })
    .from(weeklyReviews)
    .where(
      and(
        eq(weeklyReviews.userId, userId),
        eq(weeklyReviews.status, "READY"),
        eq(weeklyReviews.partial, false),
        isNull(weeklyReviews.viewedAt),
        isNull(weeklyReviews.dismissedAt),
      ),
    )
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(1);
  return row ?? null;
}

export async function markReviewViewed(userId: string, id: string): Promise<void> {
  await ownedRow(userId, id);
  await db
    .update(weeklyReviews)
    .set({ viewedAt: new Date() })
    .where(
      and(
        eq(weeklyReviews.id, id),
        eq(weeklyReviews.userId, userId),
        isNull(weeklyReviews.viewedAt),
      ),
    );
}

export async function dismissReviewCard(userId: string, id: string): Promise<void> {
  await ownedRow(userId, id);
  await db
    .update(weeklyReviews)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(weeklyReviews.id, id),
        eq(weeklyReviews.userId, userId),
        isNull(weeklyReviews.dismissedAt),
      ),
    );
}

// ---- Applying the carry-forward proposal (V2 feature 15 §5) --------------------------------------

export type CarryRow = {
  taskId: string;
  action: "KEEP" | "RESCHEDULE" | "ARCHIVE" | "CANCEL";
  dueDate?: string | null;
};

export type CarryResult = { applied: number; failed: number; undo: CarryUndo[] };

function summaryOf(counts: { rescheduled: number; archived: number; cancelled: number }): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    counts.rescheduled ? `rescheduled ${plural(counts.rescheduled, "task", "tasks")}` : null,
    counts.archived ? `archived ${plural(counts.archived, "task", "tasks")}` : null,
    counts.cancelled ? `cancelled ${plural(counts.cancelled, "task", "tasks")}` : null,
  ].filter((p): p is string => p !== null);
  const text = parts.length ? parts.join(", ") : "no changes";
  return `Weekly review: ${text}`;
}

/**
 * Does exactly the ticked rows, through the existing commands (a reschedule is `updateTask` with the reason
 * `REVIEW`), and writes one `audit_log` row with counts only. Once per set of suggestions: a second apply finds
 * it taken. Nothing is written by anything else.
 */
export async function applyCarryForward(
  userId: string,
  input: { reviewId: string; rows: CarryRow[] },
): Promise<CarryResult> {
  const prefs = await getPreferences(userId);
  const row = await ownedRow(userId, input.reviewId);
  const facts = asFacts(row);
  if (!facts || row.status !== "READY") throw new AppError("NOT_FOUND");
  const allowed = relevantTasks(facts);
  const today = getUserToday(prefs, new Date());

  const seen = new Set<string>();
  const rows: CarryRow[] = [];
  for (const r of input.rows) {
    if (!allowed.has(r.taskId))
      throw new AppError("VALIDATION_ERROR", "That task isn't in this review.");
    if (seen.has(r.taskId)) continue;
    seen.add(r.taskId);
    if (r.action === "RESCHEDULE") {
      if (!r.dueDate || r.dueDate < today) {
        throw new AppError("VALIDATION_ERROR", "Choose a date from today on.", {
          fieldErrors: { dueDate: "Choose a date from today on." },
        });
      }
    }
    rows.push(r);
  }
  const changes = rows.filter((r) => r.action !== "KEEP");

  // Claim: only one apply per set of suggestions (a double click, a second tab).
  const [claimed] = await db
    .update(weeklyReviews)
    .set({ carryAppliedAt: new Date() })
    .where(
      and(
        eq(weeklyReviews.id, row.id),
        eq(weeklyReviews.userId, userId),
        isNull(weeklyReviews.carryAppliedAt),
      ),
    )
    .returning({ id: weeklyReviews.id });
  if (!claimed) throw new AppError("CONFLICT", "These suggestions were already applied.");
  const release = () =>
    db
      .update(weeklyReviews)
      .set({ carryAppliedAt: null })
      .where(eq(weeklyReviews.id, row.id))
      .catch(() => undefined);

  const undo: CarryUndo[] = [];
  const counts = { rescheduled: 0, archived: 0, cancelled: 0 };
  const refs: { type: string; id: string }[] = [];
  let failed = 0;
  for (const change of changes) {
    try {
      const [before] = await db
        .select({ dueDate: tasks.dueDate, status: tasks.status, archivedAt: tasks.archivedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, change.taskId),
            eq(tasks.userId, userId),
            isNull(tasks.deletedAt),
            plainTasks,
          ),
        )
        .limit(1);
      if (!before) throw new AppError("NOT_FOUND");
      if (change.action === "RESCHEDULE") {
        await updateTask(
          userId,
          { id: change.taskId, dueDate: change.dueDate! },
          { reason: "REVIEW" },
        );
        counts.rescheduled += 1;
      } else if (change.action === "ARCHIVE") {
        await archiveTask(userId, change.taskId, true);
        counts.archived += 1;
      } else {
        await setTaskStatus(userId, change.taskId, "CANCELLED");
        counts.cancelled += 1;
      }
      undo.push({
        taskId: change.taskId,
        dueDate: before.dueDate,
        status: before.status,
        archived: before.archivedAt !== null,
      });
      refs.push({ type: "task", id: change.taskId });
    } catch (error) {
      failed += 1;
      logger.warn("a review change could not be applied", {
        code: error instanceof AppError ? error.code : "UNKNOWN",
      });
    }
  }
  if (changes.length > 0 && undo.length === 0) {
    await release();
    throw new AppError("VALIDATION_ERROR", "Couldn't apply those. Nothing was changed.");
  }

  await db.insert(auditLog).values({
    userId,
    source: "WEEKLY_REVIEW",
    action: "review.apply",
    entityRefs: refs,
    proposalId: `review:${row.id}:${Date.now()}`,
    summary: summaryOf(counts),
  });
  return { applied: undo.length, failed, undo };
}

/** Puts back what an apply replaced. Each task goes through the same commands, so ownership is checked again. */
export async function undoCarryForward(
  userId: string,
  input: { reviewId: string; undo: CarryUndo[] },
): Promise<number> {
  await ownedRow(userId, input.reviewId);
  let restored = 0;
  for (const item of input.undo) {
    try {
      const [now] = await db
        .select({ dueDate: tasks.dueDate, status: tasks.status, archivedAt: tasks.archivedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, item.taskId),
            eq(tasks.userId, userId),
            isNull(tasks.deletedAt),
            plainTasks,
          ),
        )
        .limit(1);
      if (!now) continue;
      if (now.dueDate !== item.dueDate) {
        await updateTask(userId, { id: item.taskId, dueDate: item.dueDate }, { reason: "REVIEW" });
      }
      if (now.status !== item.status) {
        await setTaskStatus(userId, item.taskId, item.status as never);
      }
      if ((now.archivedAt !== null) !== item.archived) {
        await archiveTask(userId, item.taskId, item.archived);
      }
      restored += 1;
    } catch (error) {
      logger.warn("a review change could not be undone", {
        code: error instanceof AppError ? error.code : "UNKNOWN",
      });
    }
  }
  // The suggestions can be applied again.
  await db
    .update(weeklyReviews)
    .set({ carryAppliedAt: null })
    .where(and(eq(weeklyReviews.id, input.reviewId), eq(weeklyReviews.userId, userId)));
  return restored;
}
