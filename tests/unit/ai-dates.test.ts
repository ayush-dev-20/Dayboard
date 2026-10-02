import { describe, expect, it } from "vitest";
import { getUserToday } from "@/lib/dates/today";
import { resolveDuePhrase } from "@/lib/dates/resolve";

// 2026-10-02 is a Friday.
describe("resolveDuePhrase", () => {
  const today = "2026-10-02";
  it("keeps a valid ISO date and rejects an impossible one", () => {
    expect(resolveDuePhrase("2026-12-25", today)).toBe("2026-12-25");
    expect(resolveDuePhrase("2026-02-30", today)).toBeNull();
  });
  it("resolves today, tomorrow and next week", () => {
    expect(resolveDuePhrase("today", today)).toBe("2026-10-02");
    expect(resolveDuePhrase("Tomorrow", today)).toBe("2026-10-03");
    expect(resolveDuePhrase("next week", today)).toBe("2026-10-09");
  });
  it("resolves weekday names to the next one after today", () => {
    expect(resolveDuePhrase("monday", today)).toBe("2026-10-05");
    expect(resolveDuePhrase("friday", today)).toBe("2026-10-09");
    expect(resolveDuePhrase("this friday", today)).toBe("2026-10-02");
    expect(resolveDuePhrase("next friday", today)).toBe("2026-10-09");
    expect(resolveDuePhrase("sunday", today)).toBe("2026-10-04");
  });
  it("resolves 'in N days/weeks' and month-day", () => {
    expect(resolveDuePhrase("in 3 days", today)).toBe("2026-10-05");
    expect(resolveDuePhrase("in 2 weeks", today)).toBe("2026-10-16");
    expect(resolveDuePhrase("Oct 3", today)).toBe("2026-10-03");
    expect(resolveDuePhrase("october 3rd", today)).toBe("2026-10-03");
  });
  it("month-day that already passed means next year", () => {
    expect(resolveDuePhrase("Sep 1", today)).toBe("2027-09-01");
    expect(resolveDuePhrase("Oct 2", today)).toBe("2026-10-02");
  });
  it("never guesses", () => {
    expect(resolveDuePhrase("soonish", today)).toBeNull();
    expect(resolveDuePhrase("", today)).toBeNull();
    expect(resolveDuePhrase(null, today)).toBeNull();
    expect(resolveDuePhrase("Feb 30", today)).toBeNull();
  });
});

describe("relative dates follow the person's own day", () => {
  // 2026-10-02 20:30 UTC is 02:00 on Oct 3 in Kolkata, and 22:30 on Oct 2 in Berlin.
  const at = new Date("2026-10-02T20:30:00Z");
  it("'tomorrow' differs by time zone", () => {
    const kolkata = getUserToday({ timezone: "Asia/Kolkata", startOfDay: "00:00" }, at);
    const berlin = getUserToday({ timezone: "Europe/Berlin", startOfDay: "00:00" }, at);
    expect(resolveDuePhrase("tomorrow", kolkata)).toBe("2026-10-04");
    expect(resolveDuePhrase("tomorrow", berlin)).toBe("2026-10-03");
  });
  it("before the start of day, 'today' is still the previous date", () => {
    const early = getUserToday({ timezone: "Asia/Kolkata", startOfDay: "06:00" }, at);
    expect(early).toBe("2026-10-02");
    expect(resolveDuePhrase("tomorrow", early)).toBe("2026-10-03");
  });
});
