import { describe, expect, it } from "vitest";
import { applyPatch, patchForCommand } from "@/lib/views/patch";
import { defaultConfig } from "@/lib/views/defaults";
import { itemScope, mayShowClosed, scopeKey } from "@/lib/views/scope";
import type { ViewConfig } from "@/lib/views/types";
import { project, tag, task } from "./views-helpers";

const withFilter = (config: ViewConfig, filter: ViewConfig["filters"][number]): ViewConfig => ({
  ...config,
  filters: [filter],
});

describe("which items a view needs read", () => {
  it("does not read finished tasks for a list or table that hides them", () => {
    expect(mayShowClosed("TASKS", "TABLE", defaultConfig("TASKS", "TABLE"))).toBe(false);
    expect(mayShowClosed("TODOS", "TABLE", defaultConfig("TODOS", "TABLE"))).toBe(false);
  });

  it("reads them when a status filter lets finished ones through, or when there is none", () => {
    const base = defaultConfig("TASKS", "TABLE");
    expect(
      mayShowClosed(
        "TASKS",
        "TABLE",
        withFilter(base, { property: "status", op: "is", value: "DONE" }),
      ),
    ).toBe(true);
    expect(
      mayShowClosed(
        "TASKS",
        "TABLE",
        withFilter(base, { property: "status", op: "isNot", value: "INBOX" }),
      ),
    ).toBe(true);
    expect(mayShowClosed("TASKS", "TABLE", { ...base, filters: [] })).toBe(true);
  });

  it("a calendar reads finished items only when it shows them", () => {
    const config = defaultConfig("TASKS", "CALENDAR");
    expect(mayShowClosed("TASKS", "CALENDAR", config)).toBe(false);
    expect(
      mayShowClosed("TASKS", "CALENDAR", {
        ...config,
        filters: [],
        calendar: { ...config.calendar!, showCompleted: true },
      }),
    ).toBe(true);
  });

  it("the scope key changes only when the set to read changes", () => {
    const table = defaultConfig("TASKS", "TABLE");
    const sorted: ViewConfig = { ...table, sorts: [{ property: "dueDate", dir: "asc" }] };
    expect(scopeKey("TASKS", "TABLE", sorted)).toBe(scopeKey("TASKS", "TABLE", table));
    expect(scopeKey("TASKS", "TABLE", { ...table, filters: [] })).not.toBe(
      scopeKey("TASKS", "TABLE", table),
    );
    expect(itemScope("TASKS", "TABLE", table).archivedOnly).toBe(false);
  });
});

describe("what a command shows before the server answers", () => {
  const ctx = { projects: [project("Launch")], tags: [tag("urgent")] };
  const now = new Date("2026-03-01T10:00:00Z");

  it("a status change sets and clears the completion time", () => {
    const done = patchForCommand(
      { type: "task.status", id: "x", status: "DONE", from: "PLANNED" },
      ctx,
      now,
    );
    expect(done).toEqual({ status: "DONE", completedAt: now.toISOString() });
    const reopened = patchForCommand(
      { type: "task.status", id: "x", status: "PLANNED", from: "DONE" },
      ctx,
      now,
    );
    expect(reopened.completedAt).toBeNull();
  });

  it("a project change shows the project, or none", () => {
    const id = ctx.projects[0]!.id;
    expect(
      patchForCommand(
        { type: "project", itemType: "task", id: "x", projectId: id, from: null },
        ctx,
        now,
      ).project?.name,
    ).toBe("Launch");
    expect(
      patchForCommand(
        { type: "project", itemType: "task", id: "x", projectId: null, from: id },
        ctx,
        now,
      ).project,
    ).toBeNull();
  });

  it("tags are looked up, and a tag that no longer exists is dropped", () => {
    const known = ctx.tags[0]!.id;
    const patch = patchForCommand(
      { type: "tags", itemType: "task", id: "x", tagIds: [known, "gone"], from: [] },
      ctx,
      now,
    );
    expect(patch.tags?.map((t) => t.name)).toEqual(["urgent"]);
  });

  it("applying a patch returns a new item and leaves the original alone", () => {
    const item = task({ title: "Before" });
    const next = applyPatch(item, { title: "After" });
    expect(next.title).toBe("After");
    expect(item.title).toBe("Before");
    expect(applyPatch(item, undefined)).toBe(item);
  });
});
