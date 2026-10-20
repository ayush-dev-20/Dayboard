import { and, eq, inArray, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCarry, dismissCard, markViewed, undoCarry } from "@/actions/review";
import { GET as getRoute } from "@/app/api/review/[weekStart]/route";
import { POST as suggestionsRoute } from "@/app/api/review/[weekStart]/suggestions/route";
import { POST as generateRoute } from "@/app/api/review/generate/route";
import { GET as latestRoute } from "@/app/api/review/latest/route";
import { GET as listRoute } from "@/app/api/review/route";
import { updateTask } from "@/actions/tasks";
import { db } from "@/db/client";
import {
  aiUsage,
  auditLog,
  featureEpochs,
  inboxItems,
  jobs,
  notes,
  projects,
  taskScheduleHistory,
  tasks,
  todos,
  user,
  userPreferences,
  weeklyReviews,
} from "@/db/schema";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs } from "@/lib/jobs/claim";
import { runClaimed } from "@/lib/jobs/runner";
import { QUEUES } from "@/lib/jobs/types";
import { enqueueReview, pruneScheduleHistory, scanForReviews } from "@/lib/review/handlers";
import { addSuggestions, generateReview, unreadReviewFor } from "@/lib/review/service";
import { currentWeek } from "@/lib/review/week";
import { uuidv7 } from "@/lib/ids";
import type { ReviewDTO } from "@/lib/review/types";
import { actAs, createTestUser, ok, setPreferences, type TestUser } from "./harness";

// V2 feature 15 against a real database and the mock provider: the facts equal what the database says, a
// review is made once per week, facts and suggestions are kept apart and survive AI being off or failing,
// carry-forward changes are applied only on confirm (audited, undoable, recorded in the schedule history), and
// the scheduled scan queues each person once. "Now" is a fixed Sunday so the week is known:
// the week is Mon 2026-10-12 to Sun 2026-10-18, and for UTC people the days begin at 06:00.

const NOW = new Date("2026-10-18T12:00:00Z");
const WEEK = "2026-10-12";
const at = (iso: string) => new Date(iso);

let bob: TestUser;

beforeAll(async () => {
  ensureBuiltinHandlers();
  bob = await createTestUser("bob-review");
});

afterAll(async () => {
  await db.delete(jobs).where(inArray(jobs.type, ["review.generate", "review.scan"]));
});

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });

async function task(
  who: TestUser,
  title: string,
  over: Partial<typeof tasks.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({ userId: who.id, title, sortOrder: 0, ...over })
    .returning({ id: tasks.id });
  return row!.id;
}
const done = (
  who: TestUser,
  title: string,
  iso: string,
  over: Partial<typeof tasks.$inferInsert> = {},
) => task(who, title, { status: "DONE", completedAt: at(iso), ...over });

/** A person with a week in it: things done, notes written, tasks left open. */
async function busyWeek(label: string) {
  const who = await createTestUser(label);
  const [project] = await db
    .insert(projects)
    .values({ userId: who.id, name: `Home ${label}`, color: "slate" as never })
    .returning({ id: projects.id });
  // Made inside the week (the review counts what a project gained in it), whatever day the test runs on.
  await done(who, "Finished one", "2026-10-13T10:00:00Z", {
    projectId: project!.id,
    createdAt: at("2026-10-13T09:00:00Z"),
  });
  await done(who, "Finished two", "2026-10-15T10:00:00Z");
  // Outside the week (before it begins at 06:00 UTC on the 12th, and after it ends on the 19th).
  await done(who, "Before", "2026-10-12T05:59:00Z");
  await done(who, "After", "2026-10-19T06:00:00Z");
  await db.insert(todos).values({
    userId: who.id,
    title: "A todo",
    isComplete: true,
    completedAt: at("2026-10-14T09:00:00Z"),
    sortOrder: 0,
  });
  await db.insert(notes).values([
    {
      userId: who.id,
      title: "Written",
      contentJson: { type: "doc", content: [] },
      createdAt: at("2026-10-14T09:00:00Z"),
      updatedAt: at("2026-10-14T09:00:00Z"),
    },
    {
      userId: who.id,
      title: "",
      contentJson: { type: "doc", content: [] },
      createdAt: at("2026-10-16T09:00:00Z"),
      updatedAt: at("2026-10-16T09:00:00Z"),
    },
    {
      userId: who.id,
      title: "Old but edited",
      contentJson: { type: "doc", content: [] },
      createdAt: at("2026-09-01T09:00:00Z"),
      updatedAt: at("2026-10-15T09:00:00Z"),
    },
    {
      userId: who.id,
      title: "Trashed",
      contentJson: { type: "doc", content: [] },
      createdAt: at("2026-10-14T09:00:00Z"),
      deletedAt: at("2026-10-15T09:00:00Z"),
    },
  ]);
  const late = await task(who, "Oldest late", { dueDate: "2026-10-05" });
  const carried = await task(who, "Due this week", {
    dueDate: "2026-10-14",
    projectId: project!.id,
    createdAt: at("2026-10-13T09:00:00Z"),
  });
  await task(who, "Due next week", { dueDate: "2026-10-20" });
  await task(who, "No date");
  await task(who, "Cancelled late", { dueDate: "2026-10-06", status: "CANCELLED" });
  await task(who, "Archived late", {
    dueDate: "2026-10-06",
    archivedAt: at("2026-10-07T00:00:00Z"),
  });
  await task(who, "Deleted late", { dueDate: "2026-10-06", deletedAt: at("2026-10-07T00:00:00Z") });
  await db.insert(inboxItems).values([
    { userId: who.id, text: "captured one", createdAt: at("2026-10-14T09:00:00Z") },
    { userId: who.id, text: "captured two", createdAt: at("2026-10-15T09:00:00Z") },
    {
      userId: who.id,
      text: "converted",
      status: "CONVERTED",
      convertedAt: at("2026-10-16T09:00:00Z"),
      createdAt: at("2026-10-01T09:00:00Z"),
    },
  ]);
  return { who, project: project!.id, late, carried };
}

const rowFor = async (who: TestUser, weekStart = WEEK) =>
  (
    await db
      .select()
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.userId, who.id), eq(weeklyReviews.weekStart, weekStart)))
  )[0];

describe("the facts", () => {
  it("equal what the database says, count only this person's week, and leave out trash, archive and other weeks", async () => {
    const { who, project, late, carried } = await busyWeek("facts");
    // Another person's week must never leak in.
    await busyWeek("facts-other");

    const { review, outcome } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(outcome).toBe("CREATED");
    const facts = review!.facts!;
    expect(facts).toMatchObject({ weekStart: WEEK, weekEnd: "2026-10-18", asOf: "2026-10-18" });
    expect(facts.completed).toMatchObject({ tasks: 2, todos: 1 });
    expect(facts.completed.recent.map((c) => c.title)).toEqual([
      "Finished two",
      "A todo",
      "Finished one",
    ]);
    expect(facts.completed.byProject.find((p) => p.projectId === project)).toMatchObject({
      count: 1,
    });
    expect(facts.overdue.count).toBe(2);
    expect(facts.overdue.carriedForward).toBe(1);
    expect(facts.overdue.items.map((i) => [i.id, i.carried, i.daysLate])).toEqual([
      [late, false, 13],
      [carried, true, 4],
    ]);
    expect(facts.notes).toMatchObject({ created: 2, edited: 1 });
    expect(facts.notes.titles.map((n) => n.title).sort()).toEqual(["Untitled", "Written"]);
    expect(facts.inbox).toEqual({ captured: 2, processed: 1 });
    expect(facts.projects.active).toEqual([
      {
        id: project,
        name: expect.stringContaining("Home"),
        completed: 1,
        tasksCreated: 2,
        notesCreated: 0,
      },
    ]);
    // No calendar is connected: the fact is absent, not estimated.
    expect(facts.calendar).toBeNull();
    // Not enough history yet: the log only began with this feature.
    expect(facts.postponements).toEqual({ enough: false, items: [] });
    // No note body, event title or private text beyond titles.
    expect(JSON.stringify(facts)).not.toMatch(/contentJson|content_text/);
  });

  it("is not made for a week with nothing done and nothing written", async () => {
    const quiet = await createTestUser("quiet");
    await task(quiet, "Only open", { dueDate: "2026-10-14" });
    const result = await generateReview(quiet.id, { origin: "AUTO", now: NOW });
    expect(result).toEqual({ review: null, outcome: "EMPTY" });
    expect(await rowFor(quiet)).toBeUndefined();
  });

  it("follows the person's week-start preference and time zone", async () => {
    const who = await createTestUser("sunday-week");
    await setPreferences(who.id, { weekStart: 0, timezone: "Asia/Kolkata" });
    // Sunday 2026-10-11 (IST) is the first day of this person's week: it is in, and the review is for 11 to 17.
    await done(who, "Sunday task", "2026-10-11T06:00:00Z");
    const result = await generateReview(who.id, {
      origin: "MANUAL",
      now: new Date("2026-10-14T12:00:00Z"),
    });
    expect(result.review).toMatchObject({ weekStart: "2026-10-11", weekEnd: "2026-10-17" });
    expect(result.review!.facts!.completed.tasks).toBe(1);
  });
});

describe("making a review", () => {
  it("is idempotent per week: a second automatic run changes nothing", async () => {
    const { who } = await busyWeek("idem");
    const first = await generateReview(who.id, { origin: "AUTO", now: NOW });
    const again = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(again.outcome).toBe("EXISTS");
    expect(again.review!.id).toBe(first.review!.id);
    expect(
      await db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, who.id)),
    ).toHaveLength(1);
    // And only one AI action was spent.
    expect(
      (
        await db
          .select()
          .from(aiUsage)
          .where(and(eq(aiUsage.userId, who.id), eq(aiUsage.feature, "WEEKLY_REVIEW")))
      ).length,
    ).toBe(1);
  });

  it("makes a week-so-far review on demand, replaces it each time, and a final one replaces it for good", async () => {
    const { who } = await busyWeek("partial");
    const first = await generateReview(who.id, { origin: "MANUAL", now: NOW });
    expect(first.review).toMatchObject({ partial: true, suggestionsStatus: "GENERATED" });
    await done(who, "Late addition", "2026-10-17T10:00:00Z");
    const second = await generateReview(who.id, { origin: "MANUAL", now: NOW });
    expect(second.review!.id).toBe(first.review!.id);
    expect(second.review!.facts!.completed.tasks).toBe(3);

    const final = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(final).toMatchObject({ outcome: "CREATED" });
    expect(final.review).toMatchObject({ id: first.review!.id, partial: false });

    // A "Generate now" afterwards never turns a final review back into a partial one.
    const again = await generateReview(who.id, { origin: "MANUAL", now: NOW });
    expect(again.outcome).toBe("KEPT_FINAL");
    expect((await rowFor(who))!.partial).toBe(false);
    expect(
      await db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, who.id)),
    ).toHaveLength(1);
  });

  it("only makes the current week", async () => {
    const { who } = await busyWeek("other-week");
    await expect(
      generateReview(who.id, { origin: "MANUAL", weekStart: "2026-10-05", now: NOW }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("facts and suggestions are kept apart", () => {
  it("stores suggestions grounded in the facts, drops the made-up id, and records one AI action", async () => {
    const { who, late, carried } = await busyWeek("grounded");
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(review).toMatchObject({ suggestionsStatus: "GENERATED", suggestionsError: null });
    const s = review!.suggestions!;
    expect(s.summary).toContain("3 things");
    expect(s.carryForward.map((c) => c.taskId)).toEqual([late, carried]);
    expect(s.carryForward[0]).toMatchObject({ action: "RESCHEDULE", newDueDate: "2026-10-19" });
    expect(s.focusAreas[0]!.basedOn[0]).toMatchObject({ fact: "overdue" });
    // The facts column is exactly what was computed: the model's answer lives in its own column.
    const row = (await rowFor(who))!;
    expect(row.facts).toEqual(review!.facts);
    expect(JSON.stringify(row.facts)).not.toContain(s.summary);
    expect(row).toMatchObject({ promptVersion: "WEEKLY_REVIEW_V1" });
  });

  it("is facts-only when AI is off, and suggestions can be added later", async () => {
    const { who } = await busyWeek("ai-off");
    await setPreferences(who.id, { aiEnabled: false });
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(review).toMatchObject({
      status: "READY",
      suggestionsStatus: "OFF",
      suggestionsError: "AI_OFF",
      suggestions: null,
    });
    expect(review!.facts!.completed.tasks).toBe(2);
    expect(
      await db
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, who.id), eq(aiUsage.feature, "WEEKLY_REVIEW"))),
    ).toHaveLength(0);

    await expect(addSuggestions(who.id, WEEK, NOW)).rejects.toMatchObject({ code: "AI_DISABLED" });
    await setPreferences(who.id, { aiEnabled: true });
    const added = await addSuggestions(who.id, WEEK, NOW);
    expect(added).toMatchObject({ suggestionsStatus: "GENERATED", suggestionsError: null });
    // The facts are the ones the person had been looking at.
    expect(added.facts).toEqual(review!.facts);
  });

  it("is facts-only when the provider fails, and Add suggestions retries", async () => {
    const { who } = await busyWeek("ai-fail");
    const bad = await task(who, "Broken [mock:error]", { dueDate: "2026-10-13" });
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(review).toMatchObject({
      suggestionsStatus: "UNAVAILABLE",
      suggestionsError: "AI_PROVIDER_ERROR",
    });
    expect(review!.facts!.overdue.count).toBe(3);

    await db.update(tasks).set({ title: "Fixed" }).where(eq(tasks.id, bad));
    // The facts still hold the old title; the failing marker is only in the stored facts. Make it a clean week.
    const stored = (await rowFor(who))!;
    await db
      .update(weeklyReviews)
      .set({ facts: JSON.parse(JSON.stringify(stored.facts).replaceAll("[mock:error]", "")) })
      .where(eq(weeklyReviews.id, stored.id));
    const retried = await addSuggestions(who.id, WEEK, NOW);
    expect(retried.suggestionsStatus).toBe("GENERATED");
  });

  it("is facts-only when the person is over the AI limit", async () => {
    const { who } = await busyWeek("ai-limit");
    await db.insert(aiUsage).values(
      Array.from({ length: 10 }, () => ({
        userId: who.id,
        feature: "ASK" as const,
        provider: "mock",
        model: "mock",
        status: "SUCCESS" as const,
        promptVersion: "ASK_V1",
        latencyMs: 1,
      })),
    );
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(review).toMatchObject({
      status: "READY",
      suggestionsStatus: "UNAVAILABLE",
      suggestionsError: "RATE_LIMITED",
      suggestions: null,
    });
    // The facts are all there, and the blocked attempt did not itself count.
    expect(review!.facts!.completed.tasks).toBe(2);
  });

  it("regenerates suggestions once a day, on the person's own day", async () => {
    const { who } = await busyWeek("regen");
    await generateReview(who.id, { origin: "AUTO", now: NOW });
    await expect(
      addSuggestions(who.id, WEEK, new Date("2026-10-18T20:00:00Z")),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    const next = await addSuggestions(who.id, WEEK, new Date("2026-10-19T00:30:00Z"));
    expect(next.suggestionsStatus).toBe("GENERATED");
    expect(next.canRegenerate).toBe(false);
  });
});

describe("the postponement fact", () => {
  it("is built from the schedule history, and says 'not enough history' until two weeks have passed", async () => {
    const { who } = await busyWeek("moves");
    const id = await task(who, "Keeps slipping", { dueDate: "2026-10-12" });
    actAs(who);
    ok(await updateTask({ id, dueDate: "2026-10-14" }));
    ok(await updateTask({ id, dueDate: "2026-10-17" }));
    // An earlier move is not a postponement; no change writes nothing.
    ok(await updateTask({ id, dueDate: "2026-10-16" }));
    ok(await updateTask({ id, dueDate: "2026-10-16" }));
    const history = await db
      .select()
      .from(taskScheduleHistory)
      .where(eq(taskScheduleHistory.taskId, id))
      .orderBy(taskScheduleHistory.changedAt);
    expect(history.map((h) => [h.fromDate, h.toDate, h.reason])).toEqual([
      ["2026-10-12", "2026-10-14", "MANUAL"],
      ["2026-10-14", "2026-10-17", "MANUAL"],
      ["2026-10-17", "2026-10-16", "MANUAL"],
    ]);

    const young = await generateReview(who.id, { origin: "MANUAL", now: new Date() });
    void young;
    const [epoch] = await db
      .select()
      .from(featureEpochs)
      .where(eq(featureEpochs.name, "task_schedule_history"));
    try {
      const real = await generateReview(who.id, { origin: "AUTO", now: NOW });
      expect(real.review!.facts!.postponements).toEqual({ enough: false, items: [] });
      await db
        .update(featureEpochs)
        .set({ startedAt: at("2026-08-01T00:00:00Z") })
        .where(eq(featureEpochs.name, "task_schedule_history"));
      await db.delete(weeklyReviews).where(eq(weeklyReviews.userId, who.id));
      const later = await generateReview(who.id, { origin: "AUTO", now: NOW });
      expect(later.review!.facts!.postponements).toEqual({
        enough: true,
        items: [{ taskId: id, title: "Keeps slipping", count: 2 }],
      });
    } finally {
      await db
        .update(featureEpochs)
        .set({ startedAt: epoch!.startedAt })
        .where(eq(featureEpochs.name, "task_schedule_history"));
    }
  });

  it("records an offline or board change through the same path, and a title edit writes nothing", async () => {
    const who = await createTestUser("history-path");
    const id = await task(who, "Plain");
    actAs(who);
    ok(await updateTask({ id, title: "Renamed" }));
    expect(
      await db.select().from(taskScheduleHistory).where(eq(taskScheduleHistory.taskId, id)),
    ).toHaveLength(0);
    ok(await updateTask({ id, dueDate: "2026-11-01" }));
    ok(await updateTask({ id, dueDate: null }));
    const rows = await db
      .select()
      .from(taskScheduleHistory)
      .where(eq(taskScheduleHistory.taskId, id))
      .orderBy(taskScheduleHistory.changedAt);
    expect(rows.map((r) => [r.fromDate, r.toDate])).toEqual([
      [null, "2026-11-01"],
      ["2026-11-01", null],
    ]);
  });

  it("removes history older than a year, and nothing newer", async () => {
    const who = await createTestUser("prune");
    const id = await task(who, "Old moves");
    await db.insert(taskScheduleHistory).values([
      {
        userId: who.id,
        taskId: id,
        fromDate: "2025-01-01",
        toDate: "2025-01-02",
        changedAt: at("2025-01-01T00:00:00Z"),
      },
      {
        userId: who.id,
        taskId: id,
        fromDate: "2026-09-01",
        toDate: "2026-09-02",
        changedAt: at("2026-09-01T00:00:00Z"),
      },
    ]);
    expect(await pruneScheduleHistory(NOW)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select()
      .from(taskScheduleHistory)
      .where(eq(taskScheduleHistory.taskId, id));
    expect(left.map((r) => r.fromDate)).toEqual(["2026-09-01"]);
  });
});

describe("applying the carry-forward proposal", () => {
  async function proposal(label: string) {
    const made = await busyWeek(label);
    const { review } = await generateReview(made.who.id, { origin: "AUTO", now: NOW });
    actAs(made.who);
    return { ...made, review: review! };
  }

  it("changes exactly the ticked rows, records REVIEW in the history, audits counts only, and can be undone", async () => {
    const { who, review, late, carried } = await proposal("apply");
    const spare = await task(who, "Left alone", { dueDate: "2026-10-13" });
    void spare;
    const result = ok(
      await applyCarry({
        reviewId: review.id,
        rows: [
          { taskId: late, action: "RESCHEDULE", dueDate: "2999-01-05" },
          { taskId: carried, action: "KEEP" },
        ],
      }),
    );
    expect(result.applied).toBe(1);
    const [moved] = await db.select().from(tasks).where(eq(tasks.id, late));
    expect(moved!.dueDate).toBe("2999-01-05");
    const [kept] = await db.select().from(tasks).where(eq(tasks.id, carried));
    expect(kept!.dueDate).toBe("2026-10-14");
    const history = await db
      .select()
      .from(taskScheduleHistory)
      .where(eq(taskScheduleHistory.taskId, late));
    expect(history).toMatchObject([
      { reason: "REVIEW", fromDate: "2026-10-05", toDate: "2999-01-05" },
    ]);

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, who.id), eq(auditLog.source, "WEEKLY_REVIEW")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toBe("Weekly review: rescheduled 1 task");
    expect(audit[0]!.summary).not.toMatch(/Oldest|late/i);
    expect(audit[0]!.entityRefs).toEqual([{ type: "task", id: late }]);
    expect((await rowFor(who))!.carryAppliedAt).not.toBeNull();

    // Once: a second apply (a double click, another tab) changes nothing.
    const twice = await applyCarry({
      reviewId: review.id,
      rows: [{ taskId: carried, action: "CANCEL" }],
    });
    expect(twice.ok ? "ok" : twice.error.code).toBe("CONFLICT");
    expect((await db.select().from(tasks).where(eq(tasks.id, carried)))[0]!.status).not.toBe(
      "CANCELLED",
    );

    // Undo puts it back, and the suggestions can be applied again.
    expect(ok(await undoCarry({ reviewId: review.id, undo: result.undo })).restored).toBe(1);
    expect((await db.select().from(tasks).where(eq(tasks.id, late)))[0]!.dueDate).toBe(
      "2026-10-05",
    );
    expect((await rowFor(who))!.carryAppliedAt).toBeNull();
  });

  it("archives and cancels as the person chose, and undo restores both", async () => {
    const { who, review, late, carried } = await proposal("drop");
    const result = ok(
      await applyCarry({
        reviewId: review.id,
        rows: [
          { taskId: late, action: "ARCHIVE" },
          { taskId: carried, action: "CANCEL" },
        ],
      }),
    );
    expect(result.applied).toBe(2);
    expect((await db.select().from(tasks).where(eq(tasks.id, late)))[0]!.archivedAt).not.toBeNull();
    expect((await db.select().from(tasks).where(eq(tasks.id, carried)))[0]!.status).toBe(
      "CANCELLED",
    );
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, who.id), eq(auditLog.source, "WEEKLY_REVIEW")));
    expect(audit!.summary).toBe("Weekly review: archived 1 task, cancelled 1 task");

    ok(await undoCarry({ reviewId: review.id, undo: result.undo }));
    expect((await db.select().from(tasks).where(eq(tasks.id, late)))[0]!.archivedAt).toBeNull();
    expect((await db.select().from(tasks).where(eq(tasks.id, carried)))[0]!.status).not.toBe(
      "CANCELLED",
    );
  });

  it("refuses a past date, a task that is not in the review, and someone else's review", async () => {
    const { who, review, late } = await proposal("refuse");
    const past = await applyCarry({
      reviewId: review.id,
      rows: [{ taskId: late, action: "RESCHEDULE", dueDate: "2020-01-01" }],
    });
    expect(past.ok ? "ok" : past.error.code).toBe("VALIDATION_ERROR");
    const foreign = await applyCarry({
      reviewId: review.id,
      rows: [{ taskId: uuidv7(), action: "CANCEL" }],
    });
    expect(foreign.ok ? "ok" : foreign.error.code).toBe("VALIDATION_ERROR");
    // Nothing changed, and nothing was claimed.
    expect((await db.select().from(tasks).where(eq(tasks.id, late)))[0]!.dueDate).toBe(
      "2026-10-05",
    );
    expect((await rowFor(who))!.carryAppliedAt).toBeNull();

    actAs(bob);
    const stolen = await applyCarry({
      reviewId: review.id,
      rows: [{ taskId: late, action: "CANCEL" }],
    });
    expect(stolen.ok ? "ok" : stolen.error.code).toBe("NOT_FOUND");
  });

  it("never touches anything before Apply", async () => {
    const { who, late } = await proposal("passive");
    expect((await db.select().from(tasks).where(eq(tasks.id, late)))[0]!.dueDate).toBe(
      "2026-10-05",
    );
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.userId, who.id), eq(auditLog.source, "WEEKLY_REVIEW"))),
    ).toHaveLength(0);
  });
});

describe("reading, ownership and the Today card", () => {
  it("serves only the person's own reviews, and a malformed or foreign week is not found", async () => {
    const { who } = await busyWeek("owner");
    await generateReview(who.id, { origin: "AUTO", now: NOW });
    actAs(who);
    const mine = (await (await getRoute(new Request("http://localhost"), params(WEEK))).json()) as {
      review: ReviewDTO;
    };
    expect(mine.review.weekStart).toBe(WEEK);
    const list = (await (await listRoute()).json()) as { reviews: { weekStart: string }[] };
    expect(list.reviews.map((r) => r.weekStart)).toContain(WEEK);
    expect(((await (await latestRoute()).json()) as { review: ReviewDTO }).review.weekStart).toBe(
      WEEK,
    );

    actAs(bob);
    expect((await getRoute(new Request("http://localhost"), params(WEEK))).status).toBe(404);
    expect((await getRoute(new Request("http://localhost"), params("not-a-date"))).status).toBe(
      404,
    );
    expect(((await (await listRoute()).json()) as { reviews: unknown[] }).reviews).toEqual([]);
    expect(((await (await latestRoute()).json()) as { review: unknown }).review).toBeNull();
    expect(
      (await suggestionsRoute(new Request("http://localhost", { method: "POST" }), params(WEEK)))
        .status,
    ).toBe(404);
    actAs(null);
    expect((await listRoute()).status).toBe(401);
  });

  it("generate now answers with the review, or says the week is empty", async () => {
    const quiet = await createTestUser("empty-route");
    actAs(quiet);
    const empty = (await (await generateRoute(json({}))).json()) as {
      review: unknown;
      outcome: string;
    };
    expect(empty).toEqual({ review: null, outcome: "EMPTY" });
    const bad = await generateRoute(json({ weekStart: "2020-01-06" }));
    expect(bad.status).toBe(400);
    const extra = await generateRoute(json({ userId: "someone" }));
    expect(extra.status).toBe(400);
  });

  it("offers a final, unread review as a Today card until it is opened or dismissed, and never a partial one", async () => {
    const { who } = await busyWeek("card");
    await generateReview(who.id, { origin: "MANUAL", now: NOW });
    expect(await unreadReviewFor(who.id)).toBeNull();
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect((await unreadReviewFor(who.id))?.id).toBe(review!.id);

    actAs(who);
    ok(await dismissCard({ id: review!.id }));
    expect(await unreadReviewFor(who.id)).toBeNull();

    const second = await busyWeek("card-viewed");
    const made = await generateReview(second.who.id, { origin: "AUTO", now: NOW });
    actAs(second.who);
    ok(await markViewed({ id: made.review!.id }));
    expect(await unreadReviewFor(second.who.id)).toBeNull();
    // Someone else's id is not found.
    actAs(bob);
    const stolen = await dismissCard({ id: made.review!.id });
    expect(stolen.ok ? "ok" : stolen.error.code).toBe("NOT_FOUND");
  });

  it("is deleted with the account", async () => {
    const { who } = await busyWeek("deleted");
    const { review } = await generateReview(who.id, { origin: "AUTO", now: NOW });
    expect(review).not.toBeNull();
    await db.delete(user).where(eq(user.id, who.id));
    expect(await db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, who.id))).toEqual(
      [],
    );
  });
});

describe("the scheduled scan", () => {
  // The scan looks at everyone with the review switched on, and this database is shared with other tests, so only
  // the people made here are left switched on while these run.
  const mine: TestUser[] = [];
  async function person(label: string) {
    const made = await busyWeek(label);
    mine.push(made.who);
    return made.who;
  }
  async function isolate() {
    await db
      .update(userPreferences)
      .set({ weeklyReviewEnabled: false })
      .where(
        notInArray(
          userPreferences.userId,
          mine.map((m) => m.id),
        ),
      );
    await db
      .update(jobs)
      .set({ status: "CANCELLED" })
      .where(
        and(
          inArray(jobs.type, ["review.generate", "review.scan"]),
          inArray(jobs.status, ["QUEUED", "FAILED"]),
        ),
      );
  }
  async function drain() {
    for (;;) {
      const claimed = await claimJobs("review-worker", QUEUES, 20);
      if (claimed.length === 0) return;
      for (const job of claimed) await runClaimed("review-worker", job);
    }
  }
  const jobsFor = async (who: TestUser) =>
    db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, who.id), eq(jobs.type, "review.generate")));

  // Sunday 2026-10-18 at 17:30 UTC: the default review day (the last day of a Monday week) and hour (17).
  const EVENING = new Date("2026-10-18T17:30:00Z");

  it("queues one job for each person who is at their review day and hour, and only once", async () => {
    const due = await person("scan-due");
    const early = await person("scan-early");
    const off = await person("scan-off");
    const other = await person("scan-day");
    const finished = await person("scan-finished");
    await isolate();
    await setPreferences(early.id, { weeklyReviewHour: 20 });
    await setPreferences(off.id, { weeklyReviewEnabled: false });
    await setPreferences(other.id, { weeklyReviewDay: 5 });
    // A final review already exists for the week: nothing to queue.
    await generateReview(finished.id, { origin: "AUTO", now: NOW });

    await scanForReviews(EVENING);
    expect(await jobsFor(due)).toHaveLength(1);
    expect((await jobsFor(due))[0]).toMatchObject({ queue: "ai", payload: { weekStart: WEEK } });
    expect(await jobsFor(early)).toHaveLength(0);
    expect(await jobsFor(off)).toHaveLength(0);
    expect(await jobsFor(other)).toHaveLength(0);
    expect(await jobsFor(finished)).toHaveLength(0);

    // A second scan while it waits adds nothing (the dedupe key), and the job holds ids only.
    await scanForReviews(EVENING);
    expect(await jobsFor(due)).toHaveLength(1);

    // Later the same evening, the person whose hour is 20 is found too.
    await scanForReviews(new Date("2026-10-18T20:05:00Z"));
    expect(await jobsFor(early)).toHaveLength(1);
    // Still the review day when the person's day has not yet ended (Monday 04:30 for someone whose day starts at 06:00).
    const late = await person("scan-late");
    await isolate();
    await scanForReviews(new Date("2026-10-19T04:30:00Z"));
    expect(await jobsFor(late)).toHaveLength(1);
  });

  it("the job makes the review for the current week, once, and a quiet person gets none", async () => {
    const now = new Date();
    const who = await createTestUser("job-real-week");
    mine.push(who);
    await task(who, "Done today", { status: "DONE", completedAt: now });
    const quiet = await createTestUser("job-quiet");
    mine.push(quiet);
    await task(quiet, "Only open", { dueDate: "2026-10-14" });
    await isolate();

    const week = currentWeek(
      {
        timezone: "UTC",
        startOfDay: "06:00",
        weekStart: 1,
        weeklyReviewDay: null,
        weeklyReviewHour: 17,
      },
      now,
    );
    await enqueueReview(who.id, week.start);
    await enqueueReview(quiet.id, week.start);
    await drain();
    const row = (await rowFor(who, week.start))!;
    expect(row).toMatchObject({ status: "READY", partial: false, suggestionsStatus: "GENERATED" });
    expect(await rowFor(quiet, week.start)).toBeUndefined();

    // Run again (at-least-once delivery): still one review, one AI action.
    await enqueueReview(who.id, week.start);
    await drain();
    expect(
      await db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, who.id)),
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(aiUsage)
          .where(and(eq(aiUsage.userId, who.id), eq(aiUsage.feature, "WEEKLY_REVIEW")))
      ).length,
    ).toBe(1);
  });

  it("skips a job queued before the review was switched off, and one for a week that is long past", async () => {
    const off = await person("job-switched");
    await isolate();
    await enqueueReview(off.id, WEEK);
    await setPreferences(off.id, { weeklyReviewEnabled: false });
    await drain();
    expect(await rowFor(off)).toBeUndefined();

    const old = await person("job-old");
    await isolate();
    await setPreferences(old.id, { weeklyReviewEnabled: true });
    await enqueueReview(old.id, "2024-01-01");
    await drain();
    expect(await db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, old.id))).toEqual(
      [],
    );
    // The job finished (it was not retried into the dead letter queue).
    const [job] = await jobsFor(old);
    expect(job!.status).toBe("SUCCEEDED");
  });

  it("still makes a week's review when the worker is late and the week has just ended", async () => {
    const who = await person("job-late");
    // Monday 2026-10-19 00:10 UTC: the job queued on Sunday evening runs after midnight, but the person's day
    // (which starts at 06:00) has not yet rolled over, so it is still Sunday for them.
    const result = await generateReview(who.id, {
      origin: "AUTO",
      weekStart: WEEK,
      now: new Date("2026-10-19T08:00:00Z"),
    });
    expect(result.review).toMatchObject({ weekStart: WEEK, partial: false });
    expect(result.review!.facts!.asOf).toBe("2026-10-18");
    // A person asking for it is refused: only the current week.
    await expect(
      generateReview(who.id, {
        origin: "MANUAL",
        weekStart: WEEK,
        now: new Date("2026-10-19T08:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("records the review's usage as one counted AI action, with no text", async () => {
    const { who } = await busyWeek("usage");
    await generateReview(who.id, { origin: "AUTO", now: NOW });
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, who.id));
    expect(usage.map((u) => [u.feature, u.status])).toEqual([["WEEKLY_REVIEW", "SUCCESS"]]);
    expect(JSON.stringify(usage)).not.toContain("Finished");
  });
});
