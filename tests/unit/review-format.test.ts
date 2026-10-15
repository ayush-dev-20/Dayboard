import { describe, expect, it } from "vitest";
import {
  formatHours,
  formatWeekRange,
  noSuggestionsReason,
  weekdayName,
} from "@/lib/review/format";

describe("the words of the review", () => {
  it("writes a week as a range", () => {
    expect(formatWeekRange("2026-10-12", "2026-10-18")).toBe("Oct 12 – 18");
    expect(formatWeekRange("2026-10-26", "2026-11-01")).toBe("Oct 26 – Nov 1");
    expect(formatWeekRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
  it("names a weekday from a date", () => {
    expect(weekdayName("2026-10-14")).toBe("Wednesday");
  });
  it("says hours plainly", () => {
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(4.5)).toBe("4.5 hours");
  });
  it("gives one neutral line for why there are no suggestions, and none when there are", () => {
    expect(noSuggestionsReason("GENERATED", null)).toBeNull();
    expect(noSuggestionsReason("OFF", "AI_OFF")).toMatch(/AI is off/);
    expect(noSuggestionsReason("UNAVAILABLE", "RATE_LIMITED")).toMatch(/limit/);
    expect(noSuggestionsReason("UNAVAILABLE", "AI_PROVIDER_ERROR")).toMatch(/aren't available/);
    expect(noSuggestionsReason("UNAVAILABLE", "EMPTY")).toMatch(/nothing useful/);
    // Never blames the person.
    for (const error of ["AI_OFF", "RATE_LIMITED", "AI_PROVIDER_ERROR", "EMPTY"] as const) {
      expect(noSuggestionsReason("UNAVAILABLE", error)).not.toMatch(/you (failed|should|didn)/i);
    }
  });
});
