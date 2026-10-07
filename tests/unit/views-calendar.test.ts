import { describe, expect, it } from "vitest";
import {
  daysForItem,
  daysOf,
  itemsByDay,
  shiftAnchor,
  visibleRange,
  weeksOf,
} from "@/lib/views/calendar";
import { endOfWeek, startOfNextWeek, startOfWeek } from "@/lib/views/due-buckets";

describe("weeks", () => {
  it("finds the week around a day for any first day of the week", () => {
    // 2026-10-07 is a Wednesday.
    expect([startOfWeek("2026-10-07", 1), endOfWeek("2026-10-07", 1)]).toEqual([
      "2026-10-05",
      "2026-10-11",
    ]);
    expect([startOfWeek("2026-10-07", 0), endOfWeek("2026-10-07", 0)]).toEqual([
      "2026-10-04",
      "2026-10-10",
    ]);
    expect([startOfWeek("2026-10-07", 6), endOfWeek("2026-10-07", 6)]).toEqual([
      "2026-10-03",
      "2026-10-09",
    ]);
    expect(startOfNextWeek("2026-10-07", 1)).toBe("2026-10-12");
  });

  it("a day that starts the week, and one that ends it, are in their own week", () => {
    expect(endOfWeek("2026-10-05", 1)).toBe("2026-10-11");
    expect(startOfWeek("2026-10-11", 1)).toBe("2026-10-05");
  });
});

describe("the visible range", () => {
  it("a week is seven days", () => {
    const range = visibleRange("2026-10-07", "week", 1);
    expect(daysOf(range.from, range.to)).toHaveLength(7);
  });

  it("a month fills whole weeks around it", () => {
    const range = visibleRange("2026-10-15", "month", 1);
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(range).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(weeksOf(daysOf(range.from, range.to))).toHaveLength(5);
  });

  it("a month that fits exactly in four weeks shows four", () => {
    // February 2027 starts on a Monday and has 28 days.
    const range = visibleRange("2027-02-10", "month", 1);
    expect(range).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("the first day of the week moves the grid", () => {
    expect(visibleRange("2026-10-15", "month", 0)).toEqual({
      from: "2026-09-27",
      to: "2026-10-31",
    });
  });

  it("moves by month and by week, including across years", () => {
    expect(shiftAnchor("2026-12-15", "month", 1)).toBe("2027-01-01");
    expect(shiftAnchor("2026-01-15", "month", -1)).toBe("2025-12-01");
    expect(shiftAnchor("2026-10-07", "week", 1)).toBe("2026-10-14");
    expect(shiftAnchor("2026-10-07", "week", -1)).toBe("2026-09-30");
  });
});

describe("items on days", () => {
  it("an item sits on its due date", () => {
    expect(daysForItem({ dueDate: "2026-10-07" })).toEqual(["2026-10-07"]);
    expect(daysForItem({ dueDate: null })).toEqual([]);
  });

  it("a task with a start and a due date spans the days between", () => {
    expect(daysForItem({ startDate: "2026-10-05", dueDate: "2026-10-08" })).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
  });

  it("a start after the due date, or the same day, is just the due date", () => {
    expect(daysForItem({ startDate: "2026-10-09", dueDate: "2026-10-08" })).toEqual(["2026-10-08"]);
    expect(daysForItem({ startDate: "2026-10-08", dueDate: "2026-10-08" })).toEqual(["2026-10-08"]);
  });

  it("an absurdly long span is not drawn across the whole calendar", () => {
    expect(daysForItem({ startDate: "2020-01-01", dueDate: "2026-10-08" })).toEqual(["2026-10-08"]);
  });

  it("groups items by day inside the range only", () => {
    const a = { id: "a", dueDate: "2026-10-06" };
    const b = { id: "b", dueDate: "2026-10-07", startDate: "2026-10-06" };
    const out = { id: "out", dueDate: "2027-01-01" };
    const map = itemsByDay([a, b, out], { from: "2026-10-05", to: "2026-10-11" });
    expect(map.get("2026-10-06")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(map.get("2026-10-07")?.map((i) => i.id)).toEqual(["b"]);
    expect([...map.keys()]).not.toContain("2027-01-01");
  });
});
