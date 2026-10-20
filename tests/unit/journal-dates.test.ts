import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates/calendar";
import { dayBounds, journalMonthLabel, journalShortDate, journalTitle } from "@/lib/dates/journal";
import { getUserToday } from "@/lib/dates/today";

describe("journalTitle", () => {
  it("writes the weekday, the day, the month and the year", () => {
    expect(journalTitle("2026-10-13")).toBe("Tuesday, 13 October 2026");
  });

  it("does not pad a single-digit day", () => {
    expect(journalTitle("2026-03-04")).toBe("Wednesday, 4 March 2026");
  });

  it("handles the first and last day of a month and of a year", () => {
    expect(journalTitle("2026-01-01")).toBe("Thursday, 1 January 2026");
    expect(journalTitle("2026-12-31")).toBe("Thursday, 31 December 2026");
    expect(journalTitle("2026-02-28")).toBe("Saturday, 28 February 2026");
  });

  it("knows a leap day", () => {
    expect(journalTitle("2028-02-29")).toBe("Tuesday, 29 February 2028");
  });

  it("names every weekday correctly", () => {
    const names = Array.from({ length: 7 }, (_, i) => journalTitle(addDays("2026-10-12", i)));
    expect(names.map((n) => n.split(",")[0])).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("rejects something that is not a calendar date", () => {
    expect(() => journalTitle("2026-02-30")).toThrow(RangeError);
    expect(() => journalTitle("tomorrow")).toThrow(RangeError);
  });

  it("does not depend on the time zone of the runtime", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        process.env.TZ = zone;
        expect(journalTitle("2026-10-13")).toBe("Tuesday, 13 October 2026");
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("journalShortDate and journalMonthLabel", () => {
  it("shortens for the sidebar", () => {
    expect(journalShortDate("2026-10-13")).toBe("Tue 13 Oct");
    expect(journalShortDate("2026-03-04")).toBe("Wed 4 Mar");
  });

  it("labels a month", () => {
    expect(journalMonthLabel("2026-10-13")).toBe("October 2026");
  });
});

const utc = (iso: string) => new Date(iso).getTime();

describe("dayBounds", () => {
  it("runs from the default 06:00 start to the next 06:00", () => {
    const { start, end } = dayBounds("2026-10-13", { timezone: "UTC", startOfDay: "06:00" });
    expect(start.toISOString()).toBe("2026-10-13T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T06:00:00.000Z");
  });

  it("follows a custom start of day", () => {
    const { start, end } = dayBounds("2026-10-13", { timezone: "UTC", startOfDay: "03:30" });
    expect(start.toISOString()).toBe("2026-10-13T03:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T03:30:00.000Z");
  });

  it("accepts a start with seconds", () => {
    const { start } = dayBounds("2026-10-13", { timezone: "UTC", startOfDay: "06:00:00" });
    expect(start.toISOString()).toBe("2026-10-13T06:00:00.000Z");
  });

  it("is ahead of UTC for a zone ahead of it and behind it for one behind", () => {
    const ahead = dayBounds("2026-10-13", { timezone: "Asia/Kolkata", startOfDay: "06:00" });
    expect(ahead.start.toISOString()).toBe("2026-10-13T00:30:00.000Z");
    const behind = dayBounds("2026-10-13", { timezone: "America/Los_Angeles", startOfDay: "06:00" });
    expect(behind.start.toISOString()).toBe("2026-10-13T13:00:00.000Z");
  });

  it("is 23 hours when the spring-forward change falls inside it and 25 for fall-back (New York)", () => {
    const prefs = { timezone: "America/New_York", startOfDay: "06:00" };
    // The change is at 02:00 on Sunday, so it falls inside the day that began on Saturday at 06:00.
    const spring = dayBounds("2026-03-07", prefs);
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    const fall = dayBounds("2026-10-31", prefs);
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
  });

  it("is 23 and 25 hours in a southern zone too (Sydney)", () => {
    const prefs = { timezone: "Australia/Sydney", startOfDay: "06:00" };
    const fall = dayBounds("2026-04-04", prefs);
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
    const spring = dayBounds("2026-10-03", prefs);
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
  });

  it("tiles: each day ends where the next begins, across a daylight-saving change", () => {
    const prefs = { timezone: "Europe/London", startOfDay: "06:00" };
    let date = "2026-03-27";
    let previousEnd = dayBounds(date, prefs).end.getTime();
    for (let i = 0; i < 6; i += 1) {
      date = addDays(date, 1);
      const bounds = dayBounds(date, prefs);
      expect(bounds.start.getTime()).toBe(previousEnd);
      expect(bounds.end.getTime()).toBeGreaterThan(bounds.start.getTime());
      previousEnd = bounds.end.getTime();
    }
  });

  it("agrees with getUserToday at the edges (05:59 is the day before, 06:00 starts the day)", () => {
    const prefs = { timezone: "UTC", startOfDay: "06:00" };
    const { start, end } = dayBounds("2026-10-13", prefs);
    expect(getUserToday(prefs, new Date(start.getTime() - 60_000))).toBe("2026-10-12");
    expect(getUserToday(prefs, start)).toBe("2026-10-13");
    expect(getUserToday(prefs, new Date(end.getTime() - 1))).toBe("2026-10-13");
    expect(getUserToday(prefs, end)).toBe("2026-10-14");
    expect(utc("2026-10-13T05:59:00Z")).toBeLessThan(start.getTime());
  });

  it("agrees with getUserToday in a zone with daylight saving at 01:00 and 07:00", () => {
    const prefs = { timezone: "America/New_York", startOfDay: "06:00" };
    const { start, end } = dayBounds("2026-11-01", prefs);
    expect(getUserToday(prefs, new Date(start.getTime() + 60_000))).toBe("2026-11-01");
    expect(getUserToday(prefs, new Date(end.getTime() - 60_000))).toBe("2026-11-01");
    expect(getUserToday(prefs, end)).toBe("2026-11-02");
  });
});

describe("doneTime", () => {
  it("shows the time in the person's own zone, 24 hours", async () => {
    const { doneTime } = await import("@/lib/dates/journal");
    expect(doneTime("2026-10-13T08:35:00.000Z", "Asia/Kolkata")).toBe("14:05");
    expect(doneTime("2026-10-13T08:35:00.000Z", "UTC")).toBe("08:35");
    expect(doneTime("2026-10-13T00:05:00.000Z", "UTC")).toBe("00:05");
  });
});
