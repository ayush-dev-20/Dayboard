import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@/lib/colors";
import { STATUS_COLORS, TASK_STATUSES } from "@/lib/tasks/status";
import { defaultConfig } from "@/lib/views/defaults";
import { groupItems } from "@/lib/views/group";
import type { ViewConfig } from "@/lib/views/types";
import { ctx, project, task } from "./views-helpers";

// ADR 0027: statuses and due buckets carry a colour, shown as a soft fill on a board column and its header chip.
// Projects keep their own colour; a grouping with no natural colour stays plain.

const group = (by: ViewConfig["groupBy"], items = [task({ title: "a" })]) =>
  groupItems("TASKS", items, { ...defaultConfig("TASKS", "BOARD"), groupBy: by }, ctx());

describe("status colours", () => {
  it("has a colour for every status, all from the eight tag colours", () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual([...TASK_STATUSES].sort());
    for (const colour of Object.values(STATUS_COLORS)) expect(COLOR_TOKENS).toContain(colour);
  });

  it("keeps red for what is late: no status is red", () => {
    expect(Object.values(STATUS_COLORS)).not.toContain("red");
  });

  it("tells the open statuses apart from each other", () => {
    const open = ["PLANNED", "IN_PROGRESS", "WAITING"] as const;
    expect(new Set(open.map((s) => STATUS_COLORS[s])).size).toBe(open.length);
    expect(STATUS_COLORS.DONE).toBe("green");
  });
});

describe("column colours", () => {
  it("gives each status column its status colour", () => {
    const columns = group("status");
    expect(columns.map((g) => [g.key, g.color])).toEqual(
      TASK_STATUSES.map((s) => [s, STATUS_COLORS[s]]),
    );
  });

  it("colours the due buckets, with Overdue as the only red one", () => {
    const columns = group("dueBucket");
    expect(columns.find((g) => g.key === "overdue")?.color).toBe("red");
    expect(columns.filter((g) => g.color === "red")).toHaveLength(1);
    expect(columns.every((g) => g.color)).toBe(true);
  });

  it("uses the project's own colour for a project column", () => {
    const p = project("Alpha");
    const columns = group("project", [task({ title: "a", project: p })]);
    expect(columns.find((g) => g.key === p.id)?.color).toBe(p.color);
  });

  it("leaves a grouping without a natural colour plain", () => {
    expect(group("priority").every((g) => !g.color)).toBe(true);
  });
});
