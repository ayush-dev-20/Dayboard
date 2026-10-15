import { describe, expect, it } from "vitest";
import { reviewSuggestionsOutputSchema } from "@/lib/ai/schemas";
import { mockWeeklyReview } from "@/lib/ai/providers/mock-review";
import { computeFacts, daysOf, meetingHoursByDay, type FactsInput } from "@/lib/review/facts";
import { isPostponement } from "@/lib/review/history";
import { validateSuggestions } from "@/lib/review/suggestions";
import type { ReviewFacts } from "@/lib/review/types";
import {
  currentWeek,
  isReviewDue,
  recentWeekStarts,
  reviewWeekday,
  weekdayOf,
  weekOf,
  weekWindow,
  type ReviewPrefs,
} from "@/lib/review/week";

// V2 feature 15 §9, unit: week boundaries, the facts from fixtures, the validation of suggestions, and the
// schedule-history rule. No database and no model. 2026-10-14 is a Wednesday.

const IST: ReviewPrefs = {
  timezone: "Asia/Kolkata",
  startOfDay: "06:00",
  weekStart: 1,
  weeklyReviewDay: null,
  weeklyReviewHour: 17,
};

describe("week boundaries", () => {
  it("starts on the person's chosen day", () => {
    expect(weekOf("2026-10-14", 1)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(weekOf("2026-10-14", 0)).toEqual({ start: "2026-10-11", end: "2026-10-17" });
    expect(weekOf("2026-10-14", 6)).toEqual({ start: "2026-10-10", end: "2026-10-16" });
    // The first day of a week is its own week's start.
    expect(weekOf("2026-10-12", 1).start).toBe("2026-10-12");
    expect(weekOf("2026-10-18", 1).end).toBe("2026-10-18");
  });

  it("numbers weekdays from Sunday, and defaults the review to the last day of the week", () => {
    expect(weekdayOf("2026-10-11")).toBe(0);
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekdayOf("2026-10-17")).toBe(6);
    expect(reviewWeekday({ weekStart: 1, weeklyReviewDay: null })).toBe(0);
    expect(reviewWeekday({ weekStart: 0, weeklyReviewDay: null })).toBe(6);
    expect(reviewWeekday({ weekStart: 1, weeklyReviewDay: 5 })).toBe(5);
  });

  it("uses the person's today, which rolls over at their start of day", () => {
    // 2026-10-18 (Sunday) 01:00 in India is still Saturday for someone whose day starts at 06:00.
    const late = new Date("2026-10-17T19:30:00Z");
    expect(currentWeek(IST, late)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    const early = new Date("2026-10-11T19:30:00Z"); // Monday 01:00 IST, still Sunday's
    expect(currentWeek(IST, early)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("lists the last weeks, newest first", () => {
    expect(recentWeekStarts("2026-10-14", 1, 3)).toEqual([
      "2026-10-12",
      "2026-10-05",
      "2026-09-28",
    ]);
  });

  it("measures a week in the person's own time zone, including a week with a DST change", () => {
    const ny = { timezone: "America/New_York", startOfDay: "00:00" };
    const normal = weekWindow({ start: "2026-10-12", end: "2026-10-18" }, ny);
    expect((normal.to.getTime() - normal.from.getTime()) / 3_600_000).toBe(168);
    // US clocks went forward on 2026-03-08: that week has 167 hours.
    const spring = weekWindow({ start: "2026-03-08", end: "2026-03-14" }, ny);
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(167);
    const autumn = weekWindow({ start: "2026-11-01", end: "2026-11-07" }, ny);
    expect((autumn.to.getTime() - autumn.from.getTime()) / 3_600_000).toBe(169);
  });

  it("honours start of day in the window", () => {
    const { from } = weekWindow({ start: "2026-10-12", end: "2026-10-18" }, IST);
    expect(from.toISOString()).toBe("2026-10-12T00:30:00.000Z"); // 06:00 IST
  });
});

describe("when a review is due", () => {
  it("is due from the review hour on the review day, and stays due until the person's day ends", () => {
    expect(isReviewDue(IST, new Date("2026-10-18T11:29:00Z"))).toBe(false); // Sunday 16:59 IST
    expect(isReviewDue(IST, new Date("2026-10-18T11:30:00Z"))).toBe(true); // 17:00
    expect(isReviewDue(IST, new Date("2026-10-18T23:00:00Z"))).toBe(true); // Monday 04:30 IST: still Sunday's day
    expect(isReviewDue(IST, new Date("2026-10-19T00:30:00Z"))).toBe(false); // Monday 06:00 IST
  });

  it("is not due on another day, and follows the chosen day and hour", () => {
    expect(isReviewDue(IST, new Date("2026-10-14T11:30:00Z"))).toBe(false); // Wednesday
    const friday = { ...IST, weeklyReviewDay: 5, weeklyReviewHour: 9 };
    expect(isReviewDue(friday, new Date("2026-10-16T03:29:00Z"))).toBe(false); // Friday 08:59
    expect(isReviewDue(friday, new Date("2026-10-16T03:30:00Z"))).toBe(true); // 09:00
  });
});

const week = { start: "2026-10-12", end: "2026-10-18" };

function input(over: Partial<FactsInput> = {}): FactsInput {
  return {
    week,
    today: "2026-10-18",
    prefs: { timezone: "Asia/Kolkata", startOfDay: "06:00" },
    now: new Date("2026-10-18T12:00:00Z"),
    completedTaskCount: 0,
    completedTodoCount: 0,
    completedByProject: [],
    recentCompleted: [],
    openDue: [],
    openDueTotal: 0,
    openCarriedTotal: 0,
    notesCreatedTotal: 0,
    notesCreated: [],
    notesEdited: 0,
    projects: [],
    activity: [],
    activeRecently: new Set(),
    busy: null,
    historyStartedAt: null,
    postponed: [],
    inboxCaptured: 0,
    inboxProcessed: 0,
    ...over,
  };
}

describe("the facts of a week", () => {
  it("counts what was completed, by project, and lists the most recent ten", () => {
    const recent = Array.from({ length: 14 }, (_, i) => ({
      type: i % 2 ? ("todo" as const) : ("task" as const),
      id: `c${i}`,
      title: `Done ${i}`,
      completedAt: new Date(Date.UTC(2026, 9, 17, 10, 0, 14 - i)),
    }));
    const facts = computeFacts(
      input({
        completedTaskCount: 7,
        completedTodoCount: 7,
        completedByProject: [
          { projectId: "p1", count: 2 },
          { projectId: null, count: 9 },
          { projectId: "p2", count: 3 },
        ],
        recentCompleted: recent,
      }),
      new Map([
        ["p1", "Home"],
        ["p2", "Acme"],
      ]),
    );
    expect(facts.completed).toMatchObject({ tasks: 7, todos: 7 });
    expect(facts.completed.recent).toHaveLength(10);
    expect(facts.completed.recent[0]!.id).toBe("c0");
    expect(facts.completed.byProject.map((p) => [p.name, p.count])).toEqual([
      [null, 9],
      ["Acme", 3],
      ["Home", 2],
    ]);
  });

  it("classifies late and carried-forward tasks and measures days late on the last day of a finished week", () => {
    const facts = computeFacts(
      input({
        openDue: [
          { id: "t1", title: "Old", dueDate: "2026-10-05", projectId: null },
          { id: "t2", title: "This week", dueDate: "2026-10-14", projectId: "p1" },
        ],
        openDueTotal: 12,
        openCarriedTotal: 5,
      }),
      new Map(),
    );
    expect(facts.overdue.count).toBe(12);
    expect(facts.overdue.carriedForward).toBe(5);
    expect(facts.overdue.items).toEqual([
      {
        id: "t1",
        title: "Old",
        dueDate: "2026-10-05",
        daysLate: 13,
        carried: false,
        projectId: null,
      },
      {
        id: "t2",
        title: "This week",
        dueDate: "2026-10-14",
        daysLate: 4,
        carried: true,
        projectId: "p1",
      },
    ]);
  });

  it("measures an unfinished week on today, never below zero", () => {
    const facts = computeFacts(
      input({
        today: "2026-10-14",
        openDue: [{ id: "t", title: "Friday task", dueDate: "2026-10-16", projectId: null }],
        openDueTotal: 1,
        openCarriedTotal: 1,
      }),
      new Map(),
    );
    expect(facts.asOf).toBe("2026-10-14");
    expect(facts.overdue.items[0]!.daysLate).toBe(0);
  });

  it("names the notes and counts the edited ones", () => {
    const titles = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` }));
    const facts = computeFacts(
      input({ notesCreatedTotal: 12, notesCreated: titles, notesEdited: 4 }),
      new Map(),
    );
    expect(facts.notes).toMatchObject({ created: 12, edited: 4 });
    expect(facts.notes.titles).toHaveLength(8);
  });

  it("finds the projects with activity, and flags the ones quiet for three weeks (not new ones)", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const facts = computeFacts(
      input({
        projects: [
          { id: "busy", name: "Busy", createdAt: old },
          { id: "quiet", name: "Quiet", createdAt: old },
          { id: "new", name: "New", createdAt: new Date("2026-10-10T00:00:00Z") },
          { id: "recent", name: "Recent", createdAt: old },
        ],
        activity: [{ projectId: "busy", completed: 3, tasksCreated: 1, notesCreated: 0 }],
        activeRecently: new Set(["busy", "recent"]),
      }),
      new Map(),
    );
    expect(facts.projects.active).toEqual([
      { id: "busy", name: "Busy", completed: 3, tasksCreated: 1, notesCreated: 0 },
    ]);
    expect(facts.projects.quiet).toEqual([{ id: "quiet", name: "Quiet" }]);
  });

  it("leaves the calendar out when none is connected, and otherwise counts hours per day", () => {
    expect(computeFacts(input(), new Map()).calendar).toBeNull();
    const busy = [
      // Tuesday 10:00 to 13:00 IST (04:30 to 07:30 UTC), and Wednesday 10:00 to 11:30.
      { start: new Date("2026-10-13T04:30:00Z"), end: new Date("2026-10-13T07:30:00Z") },
      { start: new Date("2026-10-14T04:30:00Z"), end: new Date("2026-10-14T06:00:00Z") },
    ];
    const facts = computeFacts(input({ busy }), new Map());
    expect(facts.calendar!.totalHours).toBe(4.5);
    expect(facts.calendar!.busiest).toEqual({ date: "2026-10-13", hours: 3 });
    expect(facts.calendar!.days).toHaveLength(7);
    // A week with a connected calendar and no meetings is a calendar of zeros, not a missing one.
    expect(computeFacts(input({ busy: [] }), new Map()).calendar).toMatchObject({
      totalHours: 0,
      busiest: null,
    });
  });

  it("splits a meeting that crosses midnight between the two days", () => {
    const days = daysOf(week);
    const hours = meetingHoursByDay(
      [{ start: new Date("2026-10-13T17:30:00Z"), end: new Date("2026-10-13T20:30:00Z") }], // 23:00 to 02:00 IST
      days,
      "Asia/Kolkata",
    );
    expect(hours.find((d) => d.date === "2026-10-13")!.hours).toBe(1);
    expect(hours.find((d) => d.date === "2026-10-14")!.hours).toBe(2);
  });

  it("says there is not enough history until two weeks have been recorded, and then lists repeats", () => {
    const moved = [
      { taskId: "a", title: "Report", count: 3 },
      { taskId: "b", title: "Call", count: 2 },
      { taskId: "c", title: "Once", count: 1 },
    ];
    const early = computeFacts(
      input({ historyStartedAt: new Date("2026-10-10T00:00:00Z"), postponed: moved }),
      new Map(),
    );
    expect(early.postponements).toEqual({ enough: false, items: [] });
    const none = computeFacts(input({ historyStartedAt: null }), new Map());
    expect(none.postponements.enough).toBe(false);
    const later = computeFacts(
      input({ historyStartedAt: new Date("2026-09-01T00:00:00Z"), postponed: moved }),
      new Map(),
    );
    expect(later.postponements.enough).toBe(true);
    expect(later.postponements.items.map((p) => p.taskId)).toEqual(["a", "b"]);
    expect(
      computeFacts(input({ historyStartedAt: new Date("2026-09-01T00:00:00Z") }), new Map())
        .postponements,
    ).toEqual({ enough: true, items: [] });
  });

  it("carries only titles and ids: no note body can be in a fact", () => {
    const facts = computeFacts(
      input({ notesCreatedTotal: 1, notesCreated: [{ id: "n", title: "Plan" }] }),
      new Map(),
    );
    expect(JSON.stringify(facts)).not.toMatch(/body|content/i);
  });
});

describe("the schedule history rule", () => {
  it("counts only a move to a later date from a date that was set", () => {
    expect(isPostponement("2026-10-14", "2026-10-16")).toBe(true);
    expect(isPostponement("2026-10-16", "2026-10-14")).toBe(false);
    expect(isPostponement(null, "2026-10-14")).toBe(false);
    expect(isPostponement("2026-10-14", null)).toBe(false);
    expect(isPostponement("2026-10-14", "2026-10-14")).toBe(false);
  });
});

const T1 = "0192b6a0-0000-7000-8000-000000000001";
const T2 = "0192b6a0-0000-7000-8000-000000000002";
const T3 = "0192b6a0-0000-7000-8000-000000000003";

const facts: ReviewFacts = computeFacts(
  input({
    completedTaskCount: 2,
    recentCompleted: [
      { type: "task", id: "done1", title: "Done", completedAt: new Date("2026-10-15T00:00:00Z") },
    ],
    openDue: [
      { id: T1, title: "Oldest", dueDate: "2026-10-05", projectId: null },
      { id: T2, title: "Second", dueDate: "2026-10-13", projectId: null },
    ],
    openDueTotal: 2,
    openCarriedTotal: 1,
    historyStartedAt: new Date("2026-09-01T00:00:00Z"),
    postponed: [{ taskId: T3, title: "Moved", count: 2 }],
  }),
  new Map(),
);
const TODAY = "2026-10-18";

const raw = (over: Partial<Parameters<typeof validateSuggestions>[0]> = {}) => ({
  summary: "A short week.",
  focusAreas: [],
  carryForward: [],
  watchouts: [],
  ...over,
});

describe("validating suggestions against the facts", () => {
  it("keeps what is grounded in the review", () => {
    const out = validateSuggestions(
      raw({
        focusAreas: [
          {
            title: "Clear old tasks",
            why: "They are late.",
            basedOn: [{ fact: "overdue", ids: [T1] }],
            taskIds: [T1],
          },
        ],
        carryForward: [
          { taskId: T1, action: "RESCHEDULE", newDueDate: "2026-10-20", reason: "Give it a date." },
          { taskId: T2, action: "KEEP", reason: "Still matters." },
        ],
        watchouts: ["Moved twice."],
      }),
      facts,
      TODAY,
    )!;
    expect(out.summary).toBe("A short week.");
    expect(out.focusAreas[0]).toMatchObject({
      taskIds: [T1],
      basedOn: [{ fact: "overdue", ids: [T1] }],
    });
    expect(out.carryForward.map((c) => [c.taskId, c.action, c.newDueDate, c.title])).toEqual([
      [T1, "RESCHEDULE", "2026-10-20", "Oldest"],
      [T2, "KEEP", null, "Second"],
    ]);
  });

  it("drops unknown or foreign ids, and anything that points at nothing", () => {
    const out = validateSuggestions(
      raw({
        focusAreas: [
          {
            title: "A",
            why: "Because",
            basedOn: [{ fact: "overdue", ids: ["invented", T1] }],
            taskIds: ["invented", T1],
          },
          { title: "No basis", why: "Because", basedOn: [] },
          { title: "Calendar", why: "Because", basedOn: [{ fact: "calendar", ids: [] }] },
        ],
        carryForward: [{ taskId: "invented", action: "KEEP", reason: "x" }],
      }),
      facts,
      TODAY,
    )!;
    // The calendar is not a fact of this review (none is connected), so that area has nothing to rest on.
    expect(out.focusAreas).toHaveLength(1);
    expect(out.focusAreas[0]).toMatchObject({
      taskIds: [T1],
      basedOn: [{ fact: "overdue", ids: [T1] }],
    });
    expect(out.carryForward).toEqual([]);
  });

  it("refuses a past date, resolves a phrase, and drops a reschedule it cannot date", () => {
    const out = validateSuggestions(
      raw({
        carryForward: [
          { taskId: T1, action: "RESCHEDULE", newDueDate: "2026-10-10", reason: "Past." },
          { taskId: T2, action: "RESCHEDULE", newDueDate: "tomorrow", reason: "Soon." },
          { taskId: T3, action: "RESCHEDULE", newDueDate: "someday", reason: "Vague." },
        ],
      }),
      facts,
      TODAY,
    )!;
    expect(out.carryForward.map((c) => [c.taskId, c.newDueDate])).toEqual([[T2, "2026-10-19"]]);
  });

  it("allows today as a new date, and one row per task", () => {
    const out = validateSuggestions(
      raw({
        carryForward: [
          { taskId: T1, action: "RESCHEDULE", newDueDate: "2026-10-18", reason: "Today." },
          { taskId: T1, action: "DROP", reason: "Twice." },
        ],
      }),
      facts,
      TODAY,
    )!;
    expect(out.carryForward).toHaveLength(1);
    expect(out.carryForward[0]!.newDueDate).toBe("2026-10-18");
  });

  it("caps everything and the text", () => {
    const many = Array.from({ length: 12 }, (_, i) => `W${i}`);
    const out = validateSuggestions(
      raw({
        summary: "x".repeat(900),
        focusAreas: Array.from({ length: 6 }, (_, i) => ({
          title: `Area ${i}`,
          why: "y".repeat(1000),
          basedOn: [{ fact: "completed" as const, ids: ["done1"] }],
        })),
        watchouts: many,
      }),
      facts,
      TODAY,
    )!;
    expect(out.summary.length).toBeLessThanOrEqual(400);
    expect(out.focusAreas).toHaveLength(3);
    expect(out.focusAreas[0]!.why.length).toBeLessThanOrEqual(300);
    expect(out.watchouts).toHaveLength(3);
  });

  it("treats an answer with nothing valid left as unavailable", () => {
    expect(
      validateSuggestions(
        raw({ summary: "  ", carryForward: [{ taskId: "invented", action: "KEEP", reason: "x" }] }),
        facts,
        TODAY,
      ),
    ).toBeNull();
  });

  it("only points at repeated postponements when there is enough history", () => {
    const young = { ...facts, postponements: { enough: false, items: [] } };
    const out = validateSuggestions(
      raw({
        focusAreas: [
          { title: "Moves", why: "Moved often.", basedOn: [{ fact: "postponements", ids: [T3] }] },
        ],
        watchouts: ["Be careful."],
      }),
      young,
      TODAY,
    )!;
    expect(out.focusAreas).toEqual([]);
    expect(out.watchouts).toEqual(["Be careful."]);
  });
});

describe("the mock provider's review", () => {
  it("returns something the real schema accepts, built from the facts it is given", () => {
    const answer = mockWeeklyReview({ facts, today: TODAY } as never);
    expect(reviewSuggestionsOutputSchema.safeParse(answer).success).toBe(true);
    expect(answer.summary).toContain("2 things");
    // It includes an id that is not in the facts on purpose, which validation drops.
    const checked = validateSuggestions(reviewSuggestionsOutputSchema.parse(answer), facts, TODAY)!;
    expect(checked.carryForward.map((c) => c.taskId)).toEqual([T1, T2]);
    expect(checked.carryForward[0]!.newDueDate).toBe("2026-10-19");
  });
});
