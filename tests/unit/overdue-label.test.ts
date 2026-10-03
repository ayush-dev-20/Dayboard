import { describe, expect, it } from "vitest";
import { daysLate, lateDescription, lateLabel } from "@/lib/dates/relative";
import { oldestOverdueId } from "@/lib/tasks/overdue";

describe("daysLate", () => {
  it("counts whole days behind today, never negative", () => {
    expect(daysLate("2026-10-01", "2026-10-02")).toBe(1);
    expect(daysLate("2026-09-02", "2026-10-02")).toBe(30);
    expect(daysLate("2026-10-02", "2026-10-02")).toBe(0);
    expect(daysLate("2026-10-05", "2026-10-02")).toBe(0);
  });
  it("crosses month and year ends", () => {
    expect(daysLate("2025-12-31", "2026-01-02")).toBe(2);
    expect(daysLate("2024-02-28", "2024-03-01")).toBe(2); // leap year
  });
});

describe("lateLabel and lateDescription", () => {
  it("shows Nd late up to 14 days, then the date", () => {
    expect(lateLabel(0, "18:00")).toBe("Late");
    expect(lateLabel(1, "Oct 1")).toBe("1d late");
    expect(lateLabel(14, "Sep 18")).toBe("14d late");
    expect(lateLabel(15, "Sep 17")).toBe("Sep 17");
  });
  it("says the whole thing for screen readers", () => {
    expect(lateDescription(1, "Oct 1")).toBe("1 day late, due Oct 1");
    expect(lateDescription(3, "Sep 29")).toBe("3 days late, due Sep 29");
    expect(lateDescription(0, "18:00")).toBe("late, due 18:00");
  });
});

describe("oldestOverdueId (red is rare)", () => {
  const prefs = { timezone: "UTC", startOfDay: "00:00" };
  const now = new Date("2026-10-02T12:00:00Z");
  const t = (
    id: string,
    dueDate: string | null,
    dueTime: string | null = null,
    status = "PLANNED",
  ) => ({
    id,
    dueDate,
    dueTime,
    status,
  });

  it("picks the single oldest overdue item", () => {
    const items = [
      t("a", "2026-09-30"),
      t("b", "2026-09-12"),
      t("c", "2026-10-01"),
      t("d", "2026-10-05"),
    ];
    expect(oldestOverdueId(items, prefs, now)).toBe("b");
  });
  it("ignores done items and items not yet due", () => {
    const items = [t("a", "2026-09-01", null, "DONE"), t("b", "2026-10-02"), t("c", "2026-09-20")];
    expect(oldestOverdueId(items, prefs, now)).toBe("c");
  });
  it("uses the time to break a same-day tie, then list order", () => {
    const items = [
      t("a", "2026-10-02", "09:00"),
      t("b", "2026-10-02", "08:00"),
      t("c", "2026-10-02", "08:00"),
    ];
    expect(oldestOverdueId(items, prefs, now)).toBe("b");
  });
  it("is null when nothing is overdue", () => {
    expect(oldestOverdueId([t("a", null), t("b", "2026-10-09")], prefs, now)).toBeNull();
  });
});

import { looksLikeQuestion } from "@/lib/search/query";

describe("looksLikeQuestion (the command menu's Ask row)", () => {
  it("offers Ask for a question or a sentence-length query", () => {
    expect(looksLikeQuestion("budget?")).toBe(true);
    expect(looksLikeQuestion("what did we decide")).toBe(true);
    expect(looksLikeQuestion("  invoice   ")).toBe(false);
    expect(looksLikeQuestion("a?")).toBe(true);
    expect(looksLikeQuestion("?")).toBe(false);
  });
});
