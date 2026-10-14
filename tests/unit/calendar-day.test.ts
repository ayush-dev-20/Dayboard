import { describe, expect, it } from "vitest";
import { eventDays, eventsByDay } from "@/lib/calendar/day";

// Which of the person's days an event falls on (V2 feature 12 §6): timed events by the person's own day,
// all-day events by the dates they name.

const timed = (startAt: string, endAt: string) => ({ startAt, endAt, allDay: false });
const allDay = (startAt: string, endAt: string) => ({ startAt, endAt, allDay: true });

describe("eventDays", () => {
  it("puts a timed event on the person's local day, not the UTC one", () => {
    // 22:00 UTC on the 14th is already 03:30 on the 15th in Kolkata.
    expect(
      eventDays(timed("2026-10-14T22:00:00Z", "2026-10-14T23:00:00Z"), "Asia/Kolkata"),
    ).toEqual(["2026-10-15"]);
    expect(eventDays(timed("2026-10-14T22:00:00Z", "2026-10-14T23:00:00Z"), "UTC")).toEqual([
      "2026-10-14",
    ]);
    expect(
      eventDays(timed("2026-10-14T22:00:00Z", "2026-10-14T23:00:00Z"), "America/Los_Angeles"),
    ).toEqual(["2026-10-14"]);
  });

  it("lists every day an event that crosses midnight touches, and not the next day when it ends exactly at midnight", () => {
    expect(eventDays(timed("2026-10-14T22:00:00Z", "2026-10-15T02:00:00Z"), "UTC")).toEqual([
      "2026-10-14",
      "2026-10-15",
    ]);
    expect(eventDays(timed("2026-10-14T22:00:00Z", "2026-10-15T00:00:00Z"), "UTC")).toEqual([
      "2026-10-14",
    ]);
  });

  it("reads an all-day event by the dates it names, whatever the time zone, end exclusive", () => {
    const holiday = allDay("2026-10-20T00:00:00Z", "2026-10-22T00:00:00Z");
    for (const tz of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      expect(eventDays(holiday, tz), tz).toEqual(["2026-10-20", "2026-10-21"]);
    }
  });

  it("keeps a zero-length event on its day", () => {
    expect(eventDays(timed("2026-10-14T09:00:00Z", "2026-10-14T09:00:00Z"), "UTC")).toEqual([
      "2026-10-14",
    ]);
  });
});

describe("eventsByDay", () => {
  it("groups by day inside the range, with all-day first and then by start time", () => {
    const events = [
      { ...timed("2026-10-14T15:00:00Z", "2026-10-14T16:00:00Z"), title: "Late" },
      { ...timed("2026-10-14T09:00:00Z", "2026-10-14T10:00:00Z"), title: "Early" },
      { ...allDay("2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z"), title: "All day" },
      { ...timed("2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z"), title: "Outside" },
    ];
    const grouped = eventsByDay(events, { from: "2026-10-13", to: "2026-10-16" }, "UTC");
    expect([...grouped.keys()]).toEqual(["2026-10-14"]);
    expect(grouped.get("2026-10-14")!.map((e) => e.title)).toEqual(["All day", "Early", "Late"]);
  });
});
