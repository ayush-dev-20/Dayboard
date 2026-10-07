import { describe, expect, it } from "vitest";
import { dateForBucket, planMove, type MovePlan } from "@/lib/views/move-card";
import { ctx, project, tag, task, todo, note, TODAY } from "./views-helpers";

// V2 feature 06 §8: what dropping a card on a column means, for every group-by.

const col = (key: string, label = key, droppable = true) => ({ key, label, droppable });
const ok = (plan: MovePlan) => {
  if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
  return plan;
};
const refused = (plan: MovePlan) => {
  if (plan.ok) throw new Error("expected a refusal");
  return plan.reason;
};

describe("tasks by status", () => {
  it("a drop on a status sets that status", () => {
    const t = task({ status: "PLANNED" });
    const plan = ok(
      planMove("TASKS", "status", t, col("IN_PROGRESS", "In progress"), "PLANNED", ctx()),
    );
    expect(plan.commands).toEqual([
      { type: "task.status", id: t.id, status: "IN_PROGRESS", from: "PLANNED" },
    ]);
    expect(plan.message).toBe("Moved to In progress.");
  });

  it("a drop on Done is a status change to DONE (the completion logic, with recurrence, runs in the command)", () => {
    const t = task({ status: "PLANNED", dueDate: TODAY, recurrenceRule: "FREQ=DAILY" });
    const plan = ok(planMove("TASKS", "status", t, col("DONE", "Done"), "PLANNED", ctx()));
    expect(plan.commands).toEqual([
      { type: "task.status", id: t.id, status: "DONE", from: "PLANNED" },
    ]);
  });

  it("dropping where it already is changes nothing", () => {
    expect(
      refused(
        planMove("TASKS", "status", task({ status: "WAITING" }), col("WAITING"), "WAITING", ctx()),
      ),
    ).toBe("It is already there.");
  });
});

describe("tasks by priority and project", () => {
  it("priority", () => {
    const t = task({ priority: "LOW" });
    const plan = ok(planMove("TASKS", "priority", t, col("HIGH", "High"), "LOW", ctx()));
    expect(plan.commands).toEqual([
      { type: "task.priority", id: t.id, priority: "HIGH", from: "LOW" },
    ]);
  });

  it("a project, and back to no project", () => {
    const p = project("Alpha");
    const t = task({ project: null });
    expect(ok(planMove("TASKS", "project", t, col(p.id, "Alpha"), "none", ctx())).commands).toEqual(
      [{ type: "project", itemType: "task", id: t.id, projectId: p.id, from: null }],
    );
    const inProject = task({ project: p });
    const back = ok(
      planMove("TASKS", "project", inProject, col("none", "No project"), p.id, ctx()),
    );
    expect(back.commands).toEqual([
      { type: "project", itemType: "task", id: inProject.id, projectId: null, from: p.id },
    ]);
    expect(back.message).toBe("Removed from its project.");
  });
});

describe("tasks by due bucket", () => {
  // Wednesday 2026-10-07, week starts Monday: the week ends on Sunday the 11th.
  it("Today sets today", () => {
    const t = task({ dueDate: "2026-10-20" });
    expect(
      ok(planMove("TASKS", "dueBucket", t, col("today", "Today"), "later", ctx())).commands,
    ).toEqual([{ type: "task.dueDate", id: t.id, dueDate: TODAY, from: "2026-10-20" }]);
  });

  it("This week keeps the weekday when that day is still ahead, otherwise tomorrow", () => {
    // A task due on Saturday the 17th keeps "Saturday" and lands on Saturday the 10th.
    expect(dateForBucket("week", "2026-10-17", ctx())).toEqual({ date: "2026-10-10" });
    // One due on a Tuesday (already past this week) gets tomorrow.
    expect(dateForBucket("week", "2026-10-13", ctx())).toEqual({ date: "2026-10-08" });
    expect(dateForBucket("week", null, ctx())).toEqual({ date: "2026-10-08" });
    // Today's own weekday (Wednesday) is not "ahead", so tomorrow.
    expect(dateForBucket("week", "2026-10-14", ctx())).toEqual({ date: "2026-10-08" });
  });

  it("This week on the last day of the week has nowhere to go", () => {
    const sunday = ctx({ now: new Date("2026-10-11T12:00:00Z") });
    expect(dateForBucket("week", null, sunday)).toEqual({
      refused: "There are no days left in this week.",
    });
  });

  it("Later is the start of next week and No date clears the date", () => {
    expect(dateForBucket("later", null, ctx())).toEqual({ date: "2026-10-12" });
    expect(dateForBucket("later", null, ctx({ weekStart: 0 }))).toEqual({ date: "2026-10-11" });
    expect(dateForBucket("none", "2026-10-09", ctx())).toEqual({ date: null });
  });

  it("Overdue is refused: a past date cannot be chosen by dropping", () => {
    const t = task({ dueDate: "2026-10-20" });
    expect(
      refused(planMove("TASKS", "dueBucket", t, col("overdue", "Overdue", false), "later", ctx())),
    ).toMatch(/Overdue comes from a date in the past/);
    expect(dateForBucket("overdue", null, ctx())).toHaveProperty("refused");
  });

  it("Completed is not a place to drop", () => {
    expect(
      refused(planMove("TASKS", "dueBucket", task(), col("done", "Completed", false), null, ctx())),
    ).toMatch(/can't drop/);
  });

  it("a repeating task cannot lose its date", () => {
    const t = task({ dueDate: TODAY, recurrenceRule: "FREQ=WEEKLY" });
    expect(refused(planMove("TASKS", "dueBucket", t, col("none", "No date"), "today", ctx()))).toBe(
      "A repeating task needs a due date.",
    );
  });

  it("the V1 list's Upcoming group counts as this week", () => {
    const t = task({ dueDate: null });
    const plan = ok(planMove("TASKS", "dueList", t, col("upcoming", "Upcoming"), "none", ctx()));
    expect(plan.commands[0]).toMatchObject({ type: "task.dueDate", dueDate: "2026-10-08" });
  });
});

describe("tasks by tag", () => {
  const a = tag("a");
  const b = tag("b");
  const c = tag("c");

  it("moves one tag and keeps the card's other tags", () => {
    const t = task({ tags: [a, c] });
    const plan = ok(planMove("TASKS", "tag", t, col(b.id, "b"), a.id, ctx()));
    expect(plan.commands).toEqual([
      { type: "tags", itemType: "task", id: t.id, tagIds: [c.id, b.id], from: [a.id, c.id] },
    ]);
    expect(plan.message).toBe("Moved to b.");
  });

  it("dropping on No tag only takes the source tag off", () => {
    const t = task({ tags: [a, c] });
    const plan = ok(planMove("TASKS", "tag", t, col("none", "No tag"), a.id, ctx()));
    expect(plan.commands[0]).toMatchObject({ tagIds: [c.id] });
    expect(plan.message).toBe("Tag removed.");
  });

  it("from No tag a drop adds the tag", () => {
    const t = task({ tags: [] });
    const plan = ok(planMove("TASKS", "tag", t, col(a.id, "a"), "none", ctx()));
    expect(plan.commands[0]).toMatchObject({ tagIds: [a.id] });
    expect(plan.message).toBe("Tagged a.");
  });

  it("dropping on the column it came from, or on a tag it already has from another, is not a change", () => {
    const t = task({ tags: [a, b] });
    expect(refused(planMove("TASKS", "tag", t, col(a.id, "a"), a.id, ctx()))).toBe(
      "It is already there.",
    );
    const plan = ok(planMove("TASKS", "tag", t, col(b.id, "b"), a.id, ctx()));
    // The source tag comes off; the target was already there.
    expect(plan.commands[0]).toMatchObject({ tagIds: [b.id] });
  });
});

describe("todos and notes", () => {
  it("a todo's done column toggles it", () => {
    const t = todo();
    expect(ok(planMove("TODOS", "done", t, col("done", "Done"), "open", ctx())).commands).toEqual([
      { type: "todo.done", id: t.id, done: true },
    ]);
    expect(refused(planMove("TODOS", "done", t, col("open"), "open", ctx()))).toBe(
      "It is already there.",
    );
  });

  it("a todo's project and due bucket", () => {
    const p = project("P");
    const t = todo({ dueDate: null });
    expect(
      ok(planMove("TODOS", "project", t, col(p.id, "P"), "none", ctx())).commands[0],
    ).toMatchObject({ type: "project", itemType: "todo", projectId: p.id });
    expect(
      ok(planMove("TODOS", "dueBucket", t, col("today", "Today"), "none", ctx())).commands[0],
    ).toEqual({ type: "todo.dueDate", id: t.id, dueDate: TODAY, from: null });
  });

  it("a note's project and tag", () => {
    const p = project("Docs");
    const x = tag("x");
    const y = tag("y");
    const n = note({ tags: [x] });
    expect(
      ok(planMove("NOTES", "project", n, col(p.id, "Docs"), "none", ctx())).commands[0],
    ).toMatchObject({ type: "project", itemType: "note", projectId: p.id });
    expect(ok(planMove("NOTES", "tag", n, col(y.id, "y"), x.id, ctx())).commands[0]).toMatchObject({
      type: "tags",
      itemType: "note",
      tagIds: [y.id],
    });
  });

  it("a group-by that cannot be dropped on is refused", () => {
    expect(refused(planMove("TASKS", "nothing", task(), col("x"), null, ctx()))).toBe(
      "That can't be changed by dragging.",
    );
    expect(refused(planMove("NOTES", "nothing", note(), col("x"), null, ctx()))).toBe(
      "That can't be changed by dragging.",
    );
  });
});
