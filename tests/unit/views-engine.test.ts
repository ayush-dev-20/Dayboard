import { describe, expect, it } from "vitest";
import { groupTasks } from "@/lib/tasks/grouping";
import { defaultConfig } from "@/lib/views/defaults";
import { runView } from "@/lib/views/engine";
import { matchesFilter } from "@/lib/views/filter";
import type { ViewConfig, ViewFilter } from "@/lib/views/types";
import { ctx, NOW, note, project, tag, task, todo, TODAY } from "./views-helpers";

// V2 feature 06 §8, unit: filters, sorts and grouping by the view engine.

const cfg = (over: Partial<ViewConfig> = {}): ViewConfig => ({
  ...defaultConfig("TASKS", "TABLE"),
  filters: [],
  ...over,
});
const run = (items: ReturnType<typeof task>[], filter: ViewFilter) =>
  runView("TASKS", items, cfg({ filters: [filter] }), ctx()).items.map((t) => t.title);

describe("filters", () => {
  const p1 = project("Alpha");
  const p2 = project("Beta");
  const t1 = tag("work");
  const t2 = tag("home");
  const items = [
    task({
      title: "a",
      status: "PLANNED",
      priority: "HIGH",
      project: p1,
      tags: [t1],
      dueDate: "2026-10-06",
    }),
    task({
      title: "b",
      status: "IN_PROGRESS",
      priority: "LOW",
      project: p2,
      tags: [t1, t2],
      dueDate: TODAY,
    }),
    task({
      title: "c",
      status: "DONE",
      priority: "NONE",
      completedAt: NOW.toISOString(),
      dueDate: "2026-10-01",
    }),
    task({
      title: "d",
      status: "WAITING",
      priority: "MEDIUM",
      dueDate: "2026-10-20",
      subtaskTotal: 3,
      noteCount: 2,
    }),
    task({ title: "e", status: "PLANNED", archived: true }),
  ];

  it("never shows archived items unless a filter asks for them", () => {
    expect(run(items, { property: "status", op: "isNotEmpty" })).toEqual(["a", "b", "c", "d"]);
    expect(run(items, { property: "archived", op: "is", value: true })).toEqual(["e"]);
  });

  it("select: is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty", () => {
    expect(run(items, { property: "status", op: "is", value: "DONE" })).toEqual(["c"]);
    expect(run(items, { property: "status", op: "isNot", value: "DONE" })).toEqual(["a", "b", "d"]);
    expect(
      run(items, { property: "status", op: "isAnyOf", value: ["PLANNED", "WAITING"] }),
    ).toEqual(["a", "d"]);
    expect(run(items, { property: "priority", op: "isNoneOf", value: ["NONE", "LOW"] })).toEqual([
      "a",
      "d",
    ]);
    expect(run(items, { property: "project", op: "isEmpty" })).toEqual(["c", "d"]);
    expect(run(items, { property: "project", op: "isNotEmpty" })).toEqual(["a", "b"]);
    expect(run(items, { property: "project", op: "is", value: p2.id })).toEqual(["b"]);
  });

  it("multi: a tag filter looks at every tag of the item", () => {
    expect(run(items, { property: "tags", op: "is", value: t2.id })).toEqual(["b"]);
    expect(run(items, { property: "tags", op: "isAnyOf", value: [t1.id, t2.id] })).toEqual([
      "a",
      "b",
    ]);
    expect(run(items, { property: "tags", op: "isNoneOf", value: [t1.id] })).toEqual(["c", "d"]);
    expect(run(items, { property: "tags", op: "isEmpty" })).toEqual(["c", "d"]);
  });

  it("text: contains ignores case, is and isNot are exact", () => {
    const named = [task({ title: "Write the REPORT" }), task({ title: "Buy milk" })];
    expect(run(named, { property: "title", op: "contains", value: "report" })).toEqual([
      "Write the REPORT",
    ]);
    expect(run(named, { property: "title", op: "is", value: "buy milk" })).toEqual(["Buy milk"]);
    expect(run(named, { property: "title", op: "isNot", value: "buy milk" })).toEqual([
      "Write the REPORT",
    ]);
  });

  it("date: is, before, after, between (inclusive) and the @today token", () => {
    expect(run(items, { property: "dueDate", op: "is", value: TODAY })).toEqual(["b"]);
    expect(run(items, { property: "dueDate", op: "before", value: "@today" })).toEqual(["a", "c"]);
    expect(run(items, { property: "dueDate", op: "after", value: "@today" })).toEqual(["d"]);
    expect(
      run(items, { property: "dueDate", op: "between", value: ["2026-10-06", TODAY] }),
    ).toEqual(["a", "b"]);
    expect(run(items, { property: "dueDate", op: "isEmpty" })).toEqual([]);
  });

  it("date: created and updated are read as the person's own calendar date", () => {
    // 23:30 UTC is already the next day in Kolkata (+05:30).
    const late = task({ title: "late", createdAt: "2026-10-06T23:30:00Z" });
    const utc = runView(
      "TASKS",
      [late],
      cfg({ filters: [{ property: "created", op: "is", value: "2026-10-06" }] }),
      ctx(),
    );
    const ist = runView(
      "TASKS",
      [late],
      cfg({ filters: [{ property: "created", op: "is", value: "2026-10-07" }] }),
      ctx({ prefs: { timezone: "Asia/Kolkata", startOfDay: "06:00" } }),
    );
    expect(utc.total).toBe(1);
    expect(ist.total).toBe(1);
  });

  it("number: is, isNot, before, after", () => {
    expect(run(items, { property: "subtasks", op: "after", value: 0 })).toEqual(["d"]);
    expect(run(items, { property: "linkedNotes", op: "is", value: 2 })).toEqual(["d"]);
    expect(run(items, { property: "subtasks", op: "before", value: 1 })).toEqual(["a", "b", "c"]);
  });

  it("boolean: todos by done", () => {
    const todos = [todo({ title: "x" }), todo({ title: "y", isComplete: true })];
    const result = runView(
      "TODOS",
      todos,
      {
        ...defaultConfig("TODOS", "TABLE"),
        filters: [{ property: "done", op: "is", value: true }],
      },
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["y"]);
  });

  it("filters are combined with AND", () => {
    const result = runView(
      "TASKS",
      items,
      cfg({
        filters: [
          { property: "tags", op: "is", value: t1.id },
          { property: "priority", op: "is", value: "LOW" },
        ],
      }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["b"]);
  });

  it("a filter on an unknown property, or with an operator that does not fit, matches nothing", () => {
    expect(run(items, { property: "colour", op: "is", value: "red" })).toEqual([]);
    expect(run(items, { property: "status", op: "contains", value: "DONE" })).toEqual([]);
    expect(
      matchesFilter(
        "TASKS",
        items[0]!,
        { property: "dueDate", op: "inBucket", value: "someday" },
        ctx(),
      ),
    ).toBe(false);
  });

  it("a filter on a project that is gone simply matches nothing", () => {
    expect(
      run(items, { property: "project", op: "is", value: "00000000-0000-4000-8000-ffffffffffff" }),
    ).toEqual([]);
  });
});

describe("due buckets", () => {
  // Wednesday 2026-10-07; with Monday as the first day this week ends on Sunday 2026-10-11.
  const dated = (
    title: string,
    dueDate: string | null,
    extra: Partial<ReturnType<typeof task>> = {},
  ) => task({ title, dueDate, ...extra });
  const items = [
    dated("yesterday", "2026-10-06"),
    dated("today", TODAY),
    dated("thursday", "2026-10-08"),
    dated("sunday", "2026-10-11"),
    dated("next monday", "2026-10-12"),
    dated("none", null),
    dated("done and old", "2026-10-01", { status: "DONE", completedAt: NOW.toISOString() }),
  ];
  const inBucket = (value: string, c = ctx()) =>
    runView(
      "TASKS",
      items,
      cfg({ filters: [{ property: "dueDate", op: "inBucket", value }] }),
      c,
    ).items.map((t) => t.title);

  it("splits open items into overdue, today, this week, later and no date", () => {
    expect(inBucket("overdue")).toEqual(["yesterday"]);
    expect(inBucket("today")).toEqual(["today"]);
    expect(inBucket("week")).toEqual(["thursday", "sunday"]);
    expect(inBucket("later")).toEqual(["next monday"]);
    expect(inBucket("none")).toEqual(["none"]);
    expect(inBucket("upcoming")).toEqual(["thursday", "sunday", "next monday"]);
  });

  it("finished items are in no bucket", () => {
    for (const bucket of ["overdue", "today", "week", "later", "none", "upcoming"]) {
      expect(inBucket(bucket)).not.toContain("done and old");
    }
  });

  it("the week ends on the day before the person's first day of the week", () => {
    // With Sunday first the week ends on Saturday 2026-10-10, so Sunday the 11th is Later.
    expect(inBucket("week", ctx({ weekStart: 0 }))).toEqual(["thursday"]);
    expect(inBucket("later", ctx({ weekStart: 0 }))).toEqual(["sunday", "next monday"]);
  });

  it("follows the person's own day: before start-of-day it is still yesterday", () => {
    // 02:00 UTC on the 7th with a 06:00 start of day is still the 6th.
    const early = ctx({
      now: new Date("2026-10-07T02:00:00Z"),
      prefs: { timezone: "UTC", startOfDay: "06:00" },
    });
    expect(inBucket("today", early)).toEqual(["yesterday"]);
    expect(inBucket("overdue", early)).toEqual([]);
  });

  it("a timed task whose time has passed is overdue today", () => {
    const timed = [
      task({ title: "morning", dueDate: TODAY, dueTime: "09:00" }),
      task({ title: "evening", dueDate: TODAY, dueTime: "18:00" }),
    ];
    const result = runView(
      "TASKS",
      timed,
      cfg({ filters: [{ property: "dueDate", op: "inBucket", value: "overdue" }] }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["morning"]);
  });
});

describe("sorting", () => {
  it("an empty sort is the manual order, then oldest first", () => {
    const a = task({ title: "a", sortOrder: 3 });
    const b = task({ title: "b", sortOrder: 1 });
    const c = task({ title: "c", sortOrder: 1 });
    expect(runView("TASKS", [a, b, c], cfg(), ctx()).items.map((t) => t.title)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by several properties, and is stable for ties", () => {
    const items = [
      task({ title: "1", priority: "LOW", dueDate: "2026-10-09" }),
      task({ title: "2", priority: "HIGH", dueDate: "2026-10-10" }),
      task({ title: "3", priority: "HIGH", dueDate: "2026-10-08" }),
      task({ title: "4", priority: "LOW", dueDate: "2026-10-09" }),
    ];
    const sorts = [
      { property: "priority", dir: "desc" as const },
      { property: "dueDate", dir: "asc" as const },
    ];
    expect(runView("TASKS", items, cfg({ sorts }), ctx()).items.map((t) => t.title)).toEqual([
      "3",
      "2",
      "1",
      "4",
    ]);
  });

  it("items without a value come last, ascending or descending", () => {
    const items = [
      task({ title: "none" }),
      task({ title: "early", dueDate: "2026-10-08" }),
      task({ title: "late", dueDate: "2026-10-20" }),
    ];
    const asc = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "dueDate", dir: "asc" }] }),
      ctx(),
    );
    const desc = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "dueDate", dir: "desc" }] }),
      ctx(),
    );
    expect(asc.items.map((t) => t.title)).toEqual(["early", "late", "none"]);
    expect(desc.items.map((t) => t.title)).toEqual(["late", "early", "none"]);
  });

  it("on one day an untimed task comes before a timed one", () => {
    const items = [
      task({ title: "timed", dueDate: TODAY, dueTime: "08:00" }),
      task({ title: "untimed", dueDate: TODAY }),
    ];
    const result = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "dueDate", dir: "asc" }] }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["untimed", "timed"]);
  });

  it("status and priority sort by their meaning, not alphabetically", () => {
    const items = [
      task({ title: "done", status: "DONE" }),
      task({ title: "inbox", status: "INBOX" }),
      task({ title: "wip", status: "IN_PROGRESS" }),
    ];
    const result = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "status", dir: "asc" }] }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["inbox", "wip", "done"]);
  });

  it("text sorts without regard to case and reads numbers as numbers", () => {
    const items = [task({ title: "item 10" }), task({ title: "Item 2" }), task({ title: "apple" })];
    const result = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "title", dir: "asc" }] }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["apple", "Item 2", "item 10"]);
  });

  it("sorts by project name and by tags", () => {
    const b = project("Beta");
    const a = project("alpha");
    const items = [
      task({ title: "x", project: b }),
      task({ title: "y", project: a }),
      task({ title: "z" }),
    ];
    const result = runView(
      "TASKS",
      items,
      cfg({ sorts: [{ property: "project", dir: "asc" }] }),
      ctx(),
    );
    expect(result.items.map((t) => t.title)).toEqual(["y", "x", "z"]);
  });
});

describe("grouping", () => {
  it("status: every status is a group, in order, even when empty", () => {
    const result = runView(
      "TASKS",
      [task({ status: "IN_PROGRESS" })],
      cfg({ groupBy: "status" }),
      ctx(),
    );
    expect(result.groups.map((g) => g.key)).toEqual([
      "INBOX",
      "PLANNED",
      "IN_PROGRESS",
      "WAITING",
      "DONE",
      "CANCELLED",
    ]);
    expect(result.groups.map((g) => g.items.length)).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it("hide empty groups drops the empty ones", () => {
    const result = runView(
      "TASKS",
      [task({ status: "IN_PROGRESS" })],
      cfg({ groupBy: "status", hideEmptyGroups: true }),
      ctx(),
    );
    expect(result.groups.map((g) => g.key)).toEqual(["IN_PROGRESS"]);
  });

  it("priority: high first, then none", () => {
    const result = runView(
      "TASKS",
      [task({ priority: "LOW" })],
      cfg({ groupBy: "priority" }),
      ctx(),
    );
    expect(result.groups.map((g) => g.key)).toEqual(["HIGH", "MEDIUM", "LOW", "NONE"]);
  });

  it("project: one column per project, by name, then No project last", () => {
    const beta = project("Beta");
    const alpha = project("alpha");
    const items = [task({ title: "1", project: beta }), task({ title: "2" })];
    const result = runView(
      "TASKS",
      items,
      cfg({ groupBy: "project" }),
      ctx({ projects: [beta, alpha] }),
    );
    expect(result.groups.map((g) => [g.label, g.items.length])).toEqual([
      ["alpha", 0],
      ["Beta", 1],
      ["No project", 1],
    ]);
    expect(result.groups.at(-1)?.empty).toBe(true);
  });

  it("project: the manual column order wins over names", () => {
    const beta = project("Beta");
    const alpha = project("alpha");
    const result = runView(
      "TASKS",
      [],
      cfg({ groupBy: "project", boardColumnOrder: { project: [beta.id, alpha.id] } }),
      ctx({ projects: [alpha, beta] }),
    );
    expect(result.groups.map((g) => g.label)).toEqual(["Beta", "alpha", "No project"]);
  });

  it("tag: an item appears in each of its tags' groups, and No tag when it has none", () => {
    const a = tag("a");
    const b = tag("b");
    const items = [
      task({ title: "both", tags: [a, b] }),
      task({ title: "one", tags: [b] }),
      task({ title: "none" }),
    ];
    const result = runView("TASKS", items, cfg({ groupBy: "tag" }), ctx({ tags: [a, b] }));
    const by = Object.fromEntries(result.groups.map((g) => [g.label, g.items.map((t) => t.title)]));
    expect(by).toEqual({ a: ["both"], b: ["both", "one"], "No tag": ["none"] });
    expect(result.total).toBe(3);
  });

  it("due: five buckets, overdue not droppable, and finished items in Completed", () => {
    const items = [
      task({ title: "late", dueDate: "2026-10-01" }),
      task({ title: "now", dueDate: TODAY }),
      task({
        title: "finished",
        status: "DONE",
        completedAt: NOW.toISOString(),
        dueDate: "2026-10-01",
      }),
    ];
    const result = runView("TASKS", items, cfg({ groupBy: "dueBucket" }), ctx());
    expect(result.groups.map((g) => g.key)).toEqual([
      "overdue",
      "today",
      "week",
      "later",
      "none",
      "done",
    ]);
    expect(result.groups.find((g) => g.key === "overdue")?.droppable).toBe(false);
    expect(result.groups.find((g) => g.key === "done")?.droppable).toBe(false);
    expect(result.groups.find((g) => g.key === "done")?.items.map((t) => t.title)).toEqual([
      "finished",
    ]);
    expect(result.groups.find((g) => g.key === "none")?.empty).toBe(true);
  });

  it("the V1 list's due groups give exactly what the V1 grouping function gives", () => {
    const prefs = { timezone: "UTC", startOfDay: "00:00" };
    const items = [
      task({ title: "o1", dueDate: "2026-10-02" }),
      task({ title: "o2", dueDate: TODAY, dueTime: "08:00" }),
      task({ title: "t1", dueDate: TODAY }),
      task({ title: "u1", dueDate: "2026-10-09" }),
      task({ title: "u2", dueDate: "2027-01-01" }),
      task({ title: "n1" }),
      task({ title: "n2" }),
    ];
    const v1 = groupTasks(items, prefs, NOW);
    const result = runView("TASKS", items, cfg({ groupBy: "dueList" }), ctx({ prefs }));
    const title = (list: typeof items) => list.map((t) => t.title);
    const get = (key: string) => title(result.groups.find((g) => g.key === key)?.items ?? []);
    expect(get("overdue")).toEqual(title(v1.overdue));
    expect(get("today")).toEqual(title(v1.today));
    expect(get("upcoming")).toEqual(title(v1.upcoming));
    expect(get("none")).toEqual(title(v1.nodate));
  });

  it("todos group by done, and notes by project", () => {
    const todos = runView(
      "TODOS",
      [todo(), todo({ isComplete: true })],
      { ...defaultConfig("TODOS", "BOARD") },
      ctx(),
    );
    expect(todos.groups.map((g) => [g.key, g.items.length])).toEqual([
      ["open", 1],
      ["done", 1],
    ]);
    const p = project("Docs");
    const notes = runView(
      "NOTES",
      [note({ project: p }), note()],
      { ...defaultConfig("NOTES", "BOARD") },
      ctx({ projects: [p] }),
    );
    expect(notes.groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Docs", 1],
      ["No project", 1],
    ]);
  });

  it("no group-by is one group holding everything", () => {
    const result = runView("TASKS", [task(), task()], cfg({ groupBy: null }), ctx());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.items).toHaveLength(2);
  });

  it("items inside a group follow the view's sort", () => {
    const items = [
      task({ title: "b", status: "PLANNED" }),
      task({ title: "a", status: "PLANNED" }),
    ];
    const result = runView(
      "TASKS",
      items,
      cfg({ groupBy: "status", sorts: [{ property: "title", dir: "asc" }] }),
      ctx(),
    );
    expect(result.groups.find((g) => g.key === "PLANNED")?.items.map((t) => t.title)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("speed", () => {
  it("filters, sorts and groups 5,000 items well inside a frame budget", () => {
    const projects = Array.from({ length: 10 }, (_, i) => project(`P${i}`));
    const tags = Array.from({ length: 10 }, (_, i) => tag(`T${i}`));
    const items = Array.from({ length: 5000 }, (_, i) =>
      task({
        status: (["INBOX", "PLANNED", "IN_PROGRESS", "WAITING", "DONE"] as const)[i % 5]!,
        priority: (["NONE", "LOW", "MEDIUM", "HIGH"] as const)[i % 4]!,
        dueDate:
          i % 3 === 0
            ? null
            : `2026-${String(10 + (i % 3)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
        project: i % 4 === 0 ? null : projects[i % 10]!,
        tags: i % 2 === 0 ? [tags[i % 10]!] : [],
      }),
    );
    const config = cfg({
      groupBy: "project",
      filters: [
        { property: "status", op: "isNoneOf", value: ["DONE"] },
        { property: "dueDate", op: "after", value: "2026-10-05" },
      ],
      sorts: [
        { property: "dueDate", dir: "asc" },
        { property: "title", dir: "asc" },
      ],
    });
    runView("TASKS", items, config, ctx({ projects, tags })); // warm up
    const start = performance.now();
    runView("TASKS", items, config, ctx({ projects, tags }));
    const ms = performance.now() - start;
    // The target from the feature doc (§7). It runs in about 10 ms here, so this is not tight.
    expect(ms).toBeLessThan(50);
  });
});
