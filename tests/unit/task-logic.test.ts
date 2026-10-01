import { describe, expect, it } from "vitest";
import { isSingleEmoji } from "@/lib/emoji";
import { applyDueFilter, groupTasks } from "@/lib/tasks/grouping";
import {
  MIN_ORDER_GAP,
  ORDER_STEP,
  orderAtBottom,
  orderAtTop,
  orderBetween,
  renumber,
} from "@/lib/tasks/ordering";
import {
  isOpenStatus,
  priorityBars,
  statusAfterUndo,
  statusPatch,
  TASK_STATUSES,
  UNCOMPLETE_STATUS,
} from "@/lib/tasks/status";
import { checkSubtaskParent } from "@/lib/tasks/subtasks";

describe("status", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("sets completedAt if and only if the status is DONE", () => {
    for (const status of TASK_STATUSES) {
      const patch = statusPatch(status, now);
      expect(patch.status).toBe(status);
      expect(patch.completedAt !== null).toBe(status === "DONE");
    }
    expect(statusPatch("DONE", now).completedAt).toEqual(now);
  });

  it("treats DONE and CANCELLED as closed", () => {
    expect(TASK_STATUSES.filter(isOpenStatus)).toEqual([
      "INBOX",
      "PLANNED",
      "IN_PROGRESS",
      "WAITING",
    ]);
  });

  it("never undoes back into DONE", () => {
    expect(statusAfterUndo("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(statusAfterUndo("WAITING")).toBe("WAITING");
    expect(statusAfterUndo("DONE")).toBe("PLANNED");
    expect(UNCOMPLETE_STATUS).toBe("PLANNED");
  });

  it("maps priority to bars", () => {
    expect([
      priorityBars("NONE"),
      priorityBars("LOW"),
      priorityBars("MEDIUM"),
      priorityBars("HIGH"),
    ]).toEqual([0, 1, 2, 3]);
  });
});

describe("subtask rule", () => {
  const parent = { id: "p", userId: "u1", parentTaskId: null };

  it("accepts a top-level task as parent", () => {
    expect(checkSubtaskParent(parent, { userId: "u1" })).toEqual({ ok: true });
  });

  it("refuses a missing parent or another person's task, without saying which", () => {
    expect(checkSubtaskParent(null, { userId: "u1" })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(checkSubtaskParent(parent, { userId: "u2" })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("refuses to nest under a subtask", () => {
    expect(checkSubtaskParent({ ...parent, parentTaskId: "root" }, { userId: "u1" })).toEqual({
      ok: false,
      reason: "NESTED",
    });
  });

  it("refuses to make a task its own parent", () => {
    expect(checkSubtaskParent(parent, { id: "p", userId: "u1" })).toEqual({
      ok: false,
      reason: "SELF",
    });
  });
});

describe("manual order", () => {
  it("puts new items at the top or bottom", () => {
    expect(orderAtTop(null)).toBe(0);
    expect(orderAtTop(0)).toBe(-ORDER_STEP);
    expect(orderAtBottom(null)).toBe(0);
    expect(orderAtBottom(2048)).toBe(2048 + ORDER_STEP);
  });

  it("takes the midpoint between neighbours", () => {
    expect(orderBetween(1, 3)).toEqual({ order: 2, needsRenumber: false });
    expect(orderBetween(null, 5)).toEqual({ order: 5 - ORDER_STEP, needsRenumber: false });
    expect(orderBetween(5, null)).toEqual({ order: 5 + ORDER_STEP, needsRenumber: false });
    expect(orderBetween(null, null)).toEqual({ order: 0, needsRenumber: false });
  });

  it("asks for a renumber when neighbours are almost touching", () => {
    expect(orderBetween(1, 1 + MIN_ORDER_GAP / 10).needsRenumber).toBe(true);
    expect(orderBetween(1, 1 + MIN_ORDER_GAP * 100).needsRenumber).toBe(false);
  });

  it("keeps inserting in the same gap until it runs out, then renumbers", () => {
    let above = 0;
    const below = ORDER_STEP;
    let steps = 0;
    for (; steps < 200; steps++) {
      const { order, needsRenumber } = orderBetween(above, below);
      if (needsRenumber) break;
      above = order;
    }
    expect(steps).toBeGreaterThan(25);
    expect(steps).toBeLessThan(60);
  });

  it("renumbers evenly in the given sequence", () => {
    const map = renumber(["a", "b", "c"]);
    expect([...map.entries()]).toEqual([
      ["a", 0],
      ["b", ORDER_STEP],
      ["c", ORDER_STEP * 2],
    ]);
  });
});

describe("grouping", () => {
  const prefs = { timezone: "Asia/Kolkata", startOfDay: "06:00" };
  const now = new Date("2026-10-01T04:00:00Z"); // Oct 1, 09:30 in Kolkata
  const t = (
    id: string,
    over: Partial<{
      status: "PLANNED" | "DONE";
      dueDate: string | null;
      dueTime: string | null;
    }> = {},
  ) => ({
    id,
    status: "PLANNED" as const,
    dueDate: null as string | null,
    dueTime: null as string | null,
    ...over,
  });

  it("splits open tasks into overdue, today, upcoming and no date, keeping order", () => {
    const groups = groupTasks(
      [
        t("a", { dueDate: "2026-09-12" }),
        t("b", { dueDate: "2026-10-01" }),
        t("c", { dueDate: "2026-10-09" }),
        t("d"),
        t("e", { dueDate: "2026-09-24" }),
        t("f", { dueDate: "2026-10-01", dueTime: "18:00" }),
        t("g", { dueDate: "2026-10-04" }),
      ],
      prefs,
      now,
    );
    expect(groups.overdue.map((x) => x.id)).toEqual(["a", "e"]);
    expect(groups.today.map((x) => x.id)).toEqual(["b", "f"]);
    expect(groups.upcoming.map((x) => x.id)).toEqual(["c", "g"]);
    expect(groups.nodate.map((x) => x.id)).toEqual(["d"]);
  });

  it("files a timed task whose time has passed under overdue, not today", () => {
    const groups = groupTasks([t("a", { dueDate: "2026-10-01", dueTime: "09:00" })], prefs, now);
    expect(groups.overdue).toHaveLength(1);
    expect(groups.today).toHaveLength(0);
  });

  it("leaves closed tasks out", () => {
    const groups = groupTasks([t("a", { status: "DONE", dueDate: "2026-09-01" })], prefs, now);
    expect(Object.values(groups).flat()).toHaveLength(0);
  });

  it("applies the due filter and hides empty groups", () => {
    const groups = groupTasks([t("a", { dueDate: "2026-09-12" }), t("b")], prefs, now);
    expect(applyDueFilter(groups, "any")).toEqual(["overdue", "nodate"]);
    expect(applyDueFilter(groups, "overdue")).toEqual(["overdue"]);
    expect(applyDueFilter(groups, "none")).toEqual(["nodate"]);
    expect(applyDueFilter(groups, "today")).toEqual([]);
  });
});

describe("isSingleEmoji", () => {
  it.each([
    ["a pictograph", "📞"],
    ["a heart with variation selector", "❤️"],
    ["a skin-tone emoji", "👍🏽"],
    ["a family joined with zero-width joiners", "👨‍👩‍👧"],
    ["a profession sequence", "👩🏽‍💻"],
    ["a flag", "🇮🇳"],
    ["a keycap", "1️⃣"],
    ["a subdivision flag", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  ])("accepts %s", (_name, value) => {
    expect(isSingleEmoji(value)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["a letter", "a"],
    ["a digit", "1"],
    ["words", "hello"],
    ["two emoji", "📞📞"],
    ["emoji with text", "📞 call"],
    ["leading space", " 📞"],
    ["trailing space", "📞 "],
    ["too long", "📞".repeat(20)],
  ])("rejects %s", (_name, value) => {
    expect(isSingleEmoji(value)).toBe(false);
  });
});
