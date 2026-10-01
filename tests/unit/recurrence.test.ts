import { describe, expect, it } from "vitest";
import {
  describeRule,
  describeRuleShort,
  isValidRule,
  nextOccurrence,
  parseRule,
  presetOf,
  serializeRule,
  weekdayOf,
} from "@/lib/tasks/recurrence";

// 2026-10-01 is a Thursday.
describe("nextOccurrence", () => {
  describe("daily", () => {
    it("adds one day, across month and year ends", () => {
      expect(nextOccurrence("FREQ=DAILY", "2026-10-01")).toBe("2026-10-02");
      expect(nextOccurrence("FREQ=DAILY", "2026-10-31")).toBe("2026-11-01");
      expect(nextOccurrence("FREQ=DAILY", "2026-12-31")).toBe("2027-01-01");
    });

    it("honours an interval, and Feb 28 in leap years", () => {
      expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", "2026-10-01")).toBe("2026-10-04");
      expect(nextOccurrence("FREQ=DAILY", "2028-02-28")).toBe("2028-02-29");
      expect(nextOccurrence("FREQ=DAILY", "2026-02-28")).toBe("2026-03-01");
    });
  });

  describe("weekdays", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    it("skips the weekend", () => {
      expect(nextOccurrence(rule, "2026-10-01")).toBe("2026-10-02"); // Thu -> Fri
      expect(nextOccurrence(rule, "2026-10-02")).toBe("2026-10-05"); // Fri -> Mon
      expect(nextOccurrence(rule, "2026-10-03")).toBe("2026-10-05"); // Sat -> Mon
      expect(nextOccurrence(rule, "2026-10-04")).toBe("2026-10-05"); // Sun -> Mon
    });
  });

  describe("weekly", () => {
    it("moves to the next chosen day, then wraps to next week", () => {
      const rule = "FREQ=WEEKLY;BYDAY=MO,WE";
      expect(nextOccurrence(rule, "2026-10-05")).toBe("2026-10-07"); // Mon -> Wed
      expect(nextOccurrence(rule, "2026-10-07")).toBe("2026-10-12"); // Wed -> next Mon
      expect(nextOccurrence(rule, "2026-10-09")).toBe("2026-10-12"); // Fri (not chosen) -> Mon
    });

    it("jumps whole weeks for an interval", () => {
      expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU;INTERVAL=2", "2026-10-06")).toBe("2026-10-20");
      const rule = "FREQ=WEEKLY;BYDAY=MO,TH;INTERVAL=2";
      expect(nextOccurrence(rule, "2026-10-05")).toBe("2026-10-08"); // later in the same week
      expect(nextOccurrence(rule, "2026-10-08")).toBe("2026-10-19"); // two weeks after that Monday
    });

    it("can wrap a year end", () => {
      expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-12-28")).toBe("2027-01-04");
    });
  });

  describe("monthly", () => {
    it("clamps day 31 to short months without drifting", () => {
      const rule = "FREQ=MONTHLY;BYMONTHDAY=31";
      expect(nextOccurrence(rule, "2026-01-31")).toBe("2026-02-28");
      expect(nextOccurrence(rule, "2026-02-28")).toBe("2026-03-31");
      expect(nextOccurrence(rule, "2026-03-31")).toBe("2026-04-30");
      expect(nextOccurrence(rule, "2026-04-30")).toBe("2026-05-31");
    });

    it("uses Feb 29 in a leap year", () => {
      expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", "2028-01-31")).toBe("2028-02-29");
    });

    it("rolls into the next year", () => {
      expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=15", "2026-12-15")).toBe("2027-01-15");
    });

    it("stays in the same month when the chosen day is still ahead", () => {
      expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=30", "2026-01-15")).toBe("2026-01-30");
    });
  });

  describe("yearly", () => {
    it("adds a year, and Feb 29 becomes Feb 28", () => {
      expect(nextOccurrence("FREQ=YEARLY", "2027-03-04")).toBe("2028-03-04");
      expect(nextOccurrence("FREQ=YEARLY", "2028-02-29")).toBe("2029-02-28");
    });
  });

  it("is always strictly after the previous date", () => {
    const rules = [
      "FREQ=DAILY",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      "FREQ=WEEKLY;BYDAY=SU;INTERVAL=2",
      "FREQ=MONTHLY;BYMONTHDAY=31",
      "FREQ=YEARLY",
    ];
    for (const rule of rules) {
      let date = "2026-01-01";
      for (let i = 0; i < 60; i++) {
        const next = nextOccurrence(rule, date);
        expect(next > date, `${rule} from ${date}`).toBe(true);
        date = next;
      }
    }
  });

  it("rejects unsupported rules and bad dates", () => {
    expect(() => nextOccurrence("FREQ=HOURLY", "2026-10-01")).toThrow(RangeError);
    expect(() => nextOccurrence("FREQ=DAILY", "2026-02-30")).toThrow(RangeError);
  });
});

describe("parseRule", () => {
  it.each([
    "",
    "FREQ=HOURLY",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;INTERVAL=31",
    "FREQ=DAILY;INTERVAL=abc",
    "FREQ=DAILY;COUNT=3",
    "FREQ=DAILY;FREQ=DAILY",
    "FREQ=DAILY;BYDAY=MO",
    "FREQ=WEEKLY",
    "FREQ=WEEKLY;BYDAY=",
    "FREQ=WEEKLY;BYDAY=XX",
    "FREQ=WEEKLY;BYDAY=MO,MO",
    "FREQ=MONTHLY",
    "FREQ=MONTHLY;BYMONTHDAY=0",
    "FREQ=MONTHLY;BYMONTHDAY=32",
    "FREQ=MONTHLY;BYMONTHDAY=5;INTERVAL=2",
    "FREQ=YEARLY;INTERVAL=2",
    "freq=daily",
    "FREQ",
    "FREQ=DAILY=EXTRA",
  ])("rejects %j", (rule) => {
    expect(isValidRule(rule)).toBe(false);
  });

  it("accepts every preset and sorts weekdays", () => {
    expect(parseRule("FREQ=WEEKLY;BYDAY=WE,MO")).toEqual({
      freq: "WEEKLY",
      days: ["MO", "WE"],
      interval: 1,
    });
    expect(parseRule("FREQ=DAILY;INTERVAL=30")).toEqual({ freq: "DAILY", interval: 30 });
    expect(parseRule("FREQ=YEARLY")).toEqual({ freq: "YEARLY" });
  });

  it("round-trips through serializeRule", () => {
    for (const rule of [
      "FREQ=DAILY",
      "FREQ=DAILY;INTERVAL=2",
      "FREQ=WEEKLY;BYDAY=MO,WE",
      "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
      "FREQ=MONTHLY;BYMONTHDAY=30",
      "FREQ=YEARLY",
    ]) {
      expect(serializeRule(parseRule(rule)!)).toBe(rule);
    }
  });
});

describe("describing rules", () => {
  it("uses plain words", () => {
    expect(describeRule(null)).toBe("Never");
    expect(describeRule("FREQ=DAILY")).toBe("Daily");
    expect(describeRule("FREQ=DAILY;INTERVAL=3")).toBe("Every 3 days");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Weekdays");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Weekly on Mon, Wed");
    expect(describeRule("FREQ=WEEKLY;BYDAY=TU;INTERVAL=2")).toBe("Every 2 weeks on Tue");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=30")).toBe("Monthly on day 30");
    expect(describeRule("FREQ=YEARLY")).toBe("Yearly");
  });

  it("has short forms for picker buttons", () => {
    expect(describeRuleShort("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Weekly");
    expect(describeRuleShort("FREQ=WEEKLY;BYDAY=TU;INTERVAL=2")).toBe("Every 2 weeks");
    expect(describeRuleShort(null)).toBe("Never");
  });

  it("maps a rule to its menu row", () => {
    expect(presetOf(null)).toBe("never");
    expect(presetOf("FREQ=DAILY")).toBe("daily");
    expect(presetOf("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("weekdays");
    expect(presetOf("FREQ=WEEKLY;BYDAY=MO")).toBe("weekly");
    expect(presetOf("FREQ=WEEKLY;BYDAY=MO;INTERVAL=2")).toBe("every-n-weeks");
    expect(presetOf("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("monthly");
    expect(presetOf("FREQ=YEARLY")).toBe("yearly");
  });

  it("names the weekday of a date", () => {
    expect(weekdayOf("2026-10-01")).toBe("TH");
    expect(weekdayOf("2026-10-04")).toBe("SU");
  });
});
