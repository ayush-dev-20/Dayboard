import { describe, expect, it } from "vitest";
import { formatLongDate, greetingFor } from "@/lib/dates/greeting";
import { describeActivity, formatShortDate } from "@/lib/dates/relative";
import {
  isValidTimeZone,
  listTimeZones,
  modernTimeZoneName,
  timeZoneLabel,
} from "@/lib/dates/timezones";

describe("time zones", () => {
  const at = new Date("2026-10-01T12:00:00Z");

  it("labels zones with their current UTC offset", () => {
    expect(timeZoneLabel("Asia/Kolkata", at)).toBe("Asia/Kolkata (UTC+05:30)");
    expect(timeZoneLabel("America/New_York", at)).toBe("America/New_York (UTC-04:00)");
    expect(timeZoneLabel("UTC", at)).toBe("UTC (UTC+00:00)");
  });

  it("validates IANA names, including ones the list omits", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("x".repeat(100))).toBe(false);
  });

  it("always includes UTC and the detected zone, sorted by name", () => {
    const zones = listTimeZones("Asia/Kolkata", at);
    const values = zones.map((z) => z.value);
    expect(values).toContain("UTC");
    expect(values).toContain("Asia/Kolkata");
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
  });

  it("shows modern names instead of legacy ones, with no duplicates", () => {
    expect(modernTimeZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(modernTimeZoneName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(modernTimeZoneName("Europe/London")).toBe("Europe/London");

    const values = listTimeZones("Asia/Calcutta", at).map((z) => z.value);
    expect(values).not.toContain("Asia/Calcutta");
    expect(new Set(values).size).toBe(values.length);
  });

  it("ignores an invalid detected zone instead of listing it", () => {
    expect(listTimeZones("Nowhere/Land", at).map((z) => z.value)).not.toContain("Nowhere/Land");
  });
});

describe("greeting", () => {
  // 2026-10-01T03:30:00Z is 09:00 in Kolkata and 23:30 the day before in New York.
  const instant = new Date("2026-10-01T03:30:00Z");

  it("follows the person's time zone, not the server's", () => {
    expect(greetingFor(instant, "Asia/Kolkata")).toBe("Good morning");
    expect(greetingFor(instant, "America/New_York")).toBe("Good evening");
  });

  it("changes at the documented hours", () => {
    const hour = (h: number) => new Date(`2026-10-01T${String(h).padStart(2, "0")}:00:00Z`);
    expect(greetingFor(hour(4), "UTC")).toBe("Good evening");
    expect(greetingFor(hour(5), "UTC")).toBe("Good morning");
    expect(greetingFor(hour(11), "UTC")).toBe("Good morning");
    expect(greetingFor(hour(12), "UTC")).toBe("Good afternoon");
    expect(greetingFor(hour(16), "UTC")).toBe("Good afternoon");
    expect(greetingFor(hour(17), "UTC")).toBe("Good evening");
  });

  it("formats the date in the person's time zone", () => {
    expect(formatLongDate(instant, "Asia/Kolkata")).toBe("Thursday, October 1");
    expect(formatLongDate(instant, "America/New_York")).toBe("Wednesday, September 30");
  });
});

describe("relative activity", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("says active now for the last few minutes", () => {
    expect(describeActivity(new Date("2026-10-01T11:57:00Z"), now)).toBe("active now");
  });

  it("uses relative words within a week", () => {
    expect(describeActivity(new Date("2026-10-01T10:00:00Z"), now)).toBe("2 hours ago");
    expect(describeActivity(new Date("2026-09-28T12:00:00Z"), now)).toBe("3 days ago");
  });

  it("falls back to a short date after a week", () => {
    expect(describeActivity(new Date("2026-09-20T12:00:00Z"), now)).toBe("Sep 20");
    expect(formatShortDate(new Date("2025-03-04T12:00:00Z"), now)).toBe("Mar 4, 2025");
  });
});
