import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDates,
  daysBetween,
  formatDay,
  formatPickerDay,
  isValidDateString,
  trimTime,
  weekdayIndex,
} from "@/lib/dates/calendar";
import {
  dueInstant,
  formatDueLabel,
  getUserToday,
  isDueToday,
  isOverdue,
  nextMondayOf,
  startOfUserDay,
  tomorrowOf,
} from "@/lib/dates/today";

const kolkata = { timezone: "Asia/Kolkata", startOfDay: "06:00" };
const newYork = { timezone: "America/New_York", startOfDay: "06:00" };
const calendarDay = { timezone: "UTC", startOfDay: "00:00" };

describe("calendar dates", () => {
  it("validates real dates only", () => {
    expect(isValidDateString("2026-10-01")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-1-1")).toBe(false);
    expect(isValidDateString("tomorrow")).toBe(false);
  });

  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("numbers weekdays from Monday and compares dates", () => {
    expect(weekdayIndex("2026-10-05")).toBe(0);
    expect(weekdayIndex("2026-10-11")).toBe(6);
    expect(compareDates("2026-10-01", "2026-10-02")).toBe(-1);
    expect(compareDates("2026-10-02", "2026-10-02")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
  });

  it("formats for pickers and chips", () => {
    expect(formatPickerDay("2026-09-30")).toBe("Wed, Sep 30");
    expect(formatDay("2026-09-30", "2026-10-01")).toBe("Sep 30");
    expect(formatDay("2027-01-05", "2026-10-01")).toBe("Jan 5, 2027");
    expect(trimTime("18:00:00")).toBe("18:00");
    expect(trimTime(null)).toBeNull();
  });
});

describe("getUserToday", () => {
  it("follows the person's time zone", () => {
    const instant = new Date("2026-10-01T20:00:00Z"); // 01:30 on Oct 2 in Kolkata
    expect(getUserToday(calendarDay, instant)).toBe("2026-10-01");
    expect(getUserToday({ timezone: "Asia/Kolkata", startOfDay: "00:00" }, instant)).toBe(
      "2026-10-02",
    );
  });

  it("rolls over at the start-of-day, not at midnight", () => {
    // 05:00 on Oct 1 in Kolkata is before the 06:00 rollover: still Sep 30.
    expect(getUserToday(kolkata, new Date("2026-09-30T23:30:00Z"))).toBe("2026-09-30");
    // 06:00 exactly is the new day.
    expect(getUserToday(kolkata, new Date("2026-10-01T00:30:00Z"))).toBe("2026-10-01");
  });

  it("handles a western time zone", () => {
    // 01:00 on Oct 1 in New York (EDT), before 06:00.
    expect(getUserToday(newYork, new Date("2026-10-01T05:00:00Z"))).toBe("2026-09-30");
    expect(getUserToday(newYork, new Date("2026-10-01T10:00:00Z"))).toBe("2026-10-01");
  });

  it("starts the day at the configured moment", () => {
    expect(startOfUserDay(kolkata, new Date("2026-10-01T10:00:00Z")).toISOString()).toBe(
      "2026-10-01T00:30:00.000Z",
    );
    expect(startOfUserDay(newYork, new Date("2026-10-01T15:00:00Z")).toISOString()).toBe(
      "2026-10-01T10:00:00.000Z",
    );
  });
});

describe("dueInstant and daylight saving", () => {
  it("places a wall-clock time in the right zone", () => {
    expect(dueInstant("2026-10-01", "09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-10-01T03:30:00.000Z",
    );
    expect(dueInstant("2026-10-01", null, "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("follows the clock change when daylight saving starts (New York, Mar 8 2026)", () => {
    expect(dueInstant("2026-03-07", "09:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T14:00:00.000Z",
    );
    expect(dueInstant("2026-03-08", "09:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
  });

  it("follows the clock change when daylight saving ends (New York, Nov 1 2026)", () => {
    expect(dueInstant("2026-10-31", "09:00", "America/New_York").toISOString()).toBe(
      "2026-10-31T13:00:00.000Z",
    );
    expect(dueInstant("2026-11-02", "09:00", "America/New_York").toISOString()).toBe(
      "2026-11-02T14:00:00.000Z",
    );
  });
});

describe("isOverdue and isDueToday", () => {
  const now = new Date("2026-10-01T04:00:00Z"); // 09:30 on Oct 1 in Kolkata
  const task = (
    over: Partial<{ status: string; dueDate: string | null; dueTime: string | null }>,
  ) => ({
    status: "PLANNED",
    dueDate: null,
    dueTime: null,
    ...over,
  });

  it("is overdue when the date has passed", () => {
    expect(isOverdue(task({ dueDate: "2026-09-30" }), kolkata, now)).toBe(true);
    expect(isOverdue(task({ dueDate: "2026-10-01" }), kolkata, now)).toBe(false);
    expect(isOverdue(task({ dueDate: "2026-10-02" }), kolkata, now)).toBe(false);
  });

  it("uses the time when there is one", () => {
    expect(isOverdue(task({ dueDate: "2026-10-01", dueTime: "09:00" }), kolkata, now)).toBe(true);
    expect(isOverdue(task({ dueDate: "2026-10-01", dueTime: "18:00" }), kolkata, now)).toBe(false);
  });

  it("is never overdue when closed or undated", () => {
    expect(isOverdue(task({ status: "DONE", dueDate: "2026-09-01" }), kolkata, now)).toBe(false);
    expect(isOverdue(task({ status: "CANCELLED", dueDate: "2026-09-01" }), kolkata, now)).toBe(
      false,
    );
    expect(isOverdue(task({}), kolkata, now)).toBe(false);
  });

  it("keeps yesterday's no-time task 'today' until the start-of-day rollover", () => {
    // 01:00 on Oct 1 in Kolkata: still Sep 30 for this person.
    const lateNight = new Date("2026-09-30T19:30:00Z");
    expect(isDueToday(task({ dueDate: "2026-09-30" }), kolkata, lateNight)).toBe(true);
    expect(isOverdue(task({ dueDate: "2026-09-30" }), kolkata, lateNight)).toBe(false);
    expect(
      isOverdue(task({ dueDate: "2026-09-30" }), kolkata, new Date("2026-10-01T00:30:00Z")),
    ).toBe(true);
  });

  it("is due today only for open tasks", () => {
    expect(isDueToday(task({ dueDate: "2026-10-01" }), kolkata, now)).toBe(true);
    expect(isDueToday(task({ status: "DONE", dueDate: "2026-10-01" }), kolkata, now)).toBe(false);
    expect(isDueToday(task({ dueDate: "2026-10-02" }), kolkata, now)).toBe(false);
  });
});

describe("due chip text and quick dates", () => {
  const now = new Date("2026-10-01T04:00:00Z");

  it("shows the time for a timed task due today, otherwise the date", () => {
    expect(formatDueLabel({ dueDate: "2026-10-01", dueTime: "18:00:00" }, kolkata, now)).toBe(
      "18:00",
    );
    expect(formatDueLabel({ dueDate: "2026-10-01", dueTime: null }, kolkata, now)).toBe("Oct 1");
    expect(formatDueLabel({ dueDate: "2026-10-04", dueTime: "18:00" }, kolkata, now)).toBe("Oct 4");
    expect(formatDueLabel({ dueDate: "2027-01-05", dueTime: null }, kolkata, now)).toBe(
      "Jan 5, 2027",
    );
  });

  it("finds tomorrow and the coming Monday", () => {
    expect(tomorrowOf(kolkata, now)).toBe("2026-10-02");
    expect(nextMondayOf(kolkata, now)).toBe("2026-10-05"); // Thursday -> next Monday
    expect(nextMondayOf(kolkata, new Date("2026-10-05T06:00:00Z"))).toBe("2026-10-12"); // never today
  });
});
