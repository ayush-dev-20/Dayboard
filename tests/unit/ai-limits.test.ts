import { describe, expect, it } from "vitest";
import { localDay } from "@/lib/dates/today";
import { evaluateLimits, rateLimitMessage } from "@/lib/ai/limits";

const now = new Date("2026-10-02T10:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const base = {
  now,
  nextMidnight: new Date("2026-10-03T00:00:00Z"),
  limits: { perMinute: 3, perDay: 10 },
};

describe("evaluateLimits: per minute", () => {
  it("allows up to the limit", () => {
    expect(evaluateLimits({ ...base, recentAttempts: [ago(5), ago(10)], dayCount: 2 })).toEqual({
      ok: true,
    });
  });
  it("blocks at the limit and says when the oldest attempt leaves the window", () => {
    const out = evaluateLimits({
      ...base,
      recentAttempts: [ago(50), ago(20), ago(5)],
      dayCount: 3,
    });
    expect(out).toEqual({ ok: false, scope: "minute", retryAfterSeconds: 10 });
  });
  it("ignores attempts older than a minute", () => {
    expect(
      evaluateLimits({ ...base, recentAttempts: [ago(61), ago(120), ago(5)], dayCount: 3 }),
    ).toEqual({ ok: true });
  });
  it("an attempt exactly 60 seconds old has left the window", () => {
    expect(
      evaluateLimits({ ...base, recentAttempts: [ago(60), ago(20), ago(5)], dayCount: 3 }),
    ).toEqual({ ok: true });
  });
  it("waits at least one second", () => {
    const out = evaluateLimits({
      ...base,
      recentAttempts: [ago(59.9), ago(20), ago(5)],
      dayCount: 3,
    });
    expect(out).toMatchObject({ ok: false, retryAfterSeconds: 1 });
  });
  it("with more attempts than the limit, waits for the one that frees a slot", () => {
    const out = evaluateLimits({
      ...base,
      recentAttempts: [ago(58), ago(40), ago(30), ago(5)],
      dayCount: 4,
    });
    // 4 attempts, limit 3: a slot opens when the second oldest (40s) leaves.
    expect(out).toEqual({ ok: false, scope: "minute", retryAfterSeconds: 20 });
  });
});

describe("evaluateLimits: per day", () => {
  it("allows one below the limit and blocks at it", () => {
    expect(evaluateLimits({ ...base, recentAttempts: [], dayCount: 9 })).toEqual({ ok: true });
    const out = evaluateLimits({ ...base, recentAttempts: [], dayCount: 10 });
    expect(out).toEqual({ ok: false, scope: "day", retryAfterSeconds: 14 * 3600 });
  });
  it("reports the longer wait when both limits apply", () => {
    const out = evaluateLimits({
      ...base,
      recentAttempts: [ago(50), ago(20), ago(5)],
      dayCount: 10,
    });
    expect(out).toMatchObject({ ok: false, scope: "day" });
  });
});

describe("rateLimitMessage", () => {
  it("says how many seconds to wait", () => {
    expect(rateLimitMessage({ ok: false, scope: "minute", retryAfterSeconds: 24 })).toBe(
      "That’s a lot of questions at once. Try again in 24 seconds.",
    );
    expect(rateLimitMessage({ ok: false, scope: "minute", retryAfterSeconds: 1 })).toContain(
      "1 second.",
    );
  });
});

describe("localDay (when the daily count resets)", () => {
  it("is midnight to midnight in the person's time zone", () => {
    // 2026-10-02 22:00 UTC is already 03:30 on Oct 3 in Kolkata.
    const at = new Date("2026-10-02T22:00:00Z");
    const day = localDay("Asia/Kolkata", at);
    expect(day.start.toISOString()).toBe("2026-10-02T18:30:00.000Z");
    expect(day.nextMidnight.toISOString()).toBe("2026-10-03T18:30:00.000Z");
  });
  it("resets at local midnight, not UTC midnight", () => {
    const before = localDay("America/New_York", new Date("2026-10-03T03:30:00Z")); // 23:30 on Oct 2 local
    const after = localDay("America/New_York", new Date("2026-10-03T04:30:00Z")); // 00:30 on Oct 3 local
    expect(before.nextMidnight.toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(after.start.toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(after.start.getTime()).toBeGreaterThan(before.start.getTime());
  });
});
