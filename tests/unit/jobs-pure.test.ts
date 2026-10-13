import { describe, expect, it } from "vitest";
import { advancePast, nextSlot, parseCadence } from "@/lib/jobs/schedule";
import { BASE_RETRY_MS, MAX_RETRY_MS, backoffMs, redactError } from "@/lib/jobs/retry";
import { PermanentError, RetryAfter } from "@/lib/jobs/types";
import { findHandler, registerHandler, registeredTypes } from "@/lib/jobs/registry";
import { z } from "zod";

// V2 feature 08 §8, unit level: retry timing, cadence language, redaction, the registry and the error types.

describe("retry timing", () => {
  it("starts at 30 seconds, doubles, and is capped at one hour", () => {
    const none = () => 0;
    expect([1, 2, 3].map((n) => backoffMs(n, none))).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(30, none)).toBe(MAX_RETRY_MS);
    expect(backoffMs(1, () => 0.999)).toBeLessThanOrEqual(Math.round(BASE_RETRY_MS * 1.1));
    expect(backoffMs(1, () => 0.999)).toBeGreaterThanOrEqual(BASE_RETRY_MS);
  });

  it("redacts emails and links, collapses whitespace and caps the length", () => {
    expect(redactError(new Error("Failed for a@b.co at https://x.test/a?t=1\n  again"))).toBe(
      "Failed for [email] at [link] again",
    );
    expect(redactError(new Error("x".repeat(900)))).toHaveLength(500);
    expect(redactError(new Error("   "))).toBe("The job failed.");
  });

  it("PermanentError and RetryAfter carry their meaning", () => {
    expect(new PermanentError("no").name).toBe("PermanentError");
    expect(new RetryAfter(5000).delayMs).toBe(5000);
  });
});

describe("cadence language", () => {
  it("reads every-N and daily forms, and refuses anything else", () => {
    expect(parseCadence("every 60s")).toEqual({ kind: "every", ms: 60_000 });
    expect(parseCadence("every 5m")).toEqual({ kind: "every", ms: 300_000 });
    expect(parseCadence("daily 03:15 UTC")).toEqual({ kind: "daily", hour: 3, minute: 15 });
    for (const bad of ["every 0s", "hourly", "daily 25:00 UTC", "daily 03:00", "every 5d"]) {
      expect(() => parseCadence(bad), bad).toThrow(/Invalid cadence/);
    }
  });

  it("computes the next daily slot strictly after the given time, on the right day", () => {
    const cadence = parseCadence("daily 03:00 UTC");
    expect(nextSlot(cadence, new Date("2026-10-13T02:00:00Z")).toISOString()).toBe(
      "2026-10-13T03:00:00.000Z",
    );
    expect(nextSlot(cadence, new Date("2026-10-13T03:00:00Z")).toISOString()).toBe(
      "2026-10-14T03:00:00.000Z",
    );
  });

  it("skips missed slots instead of replaying them", () => {
    const cadence = parseCadence("every 60s");
    const slot = new Date("2026-10-13T10:00:00Z");
    const now = new Date("2026-10-13T10:10:30Z");
    expect(advancePast(cadence, slot, now).toISOString()).toBe("2026-10-13T10:11:00.000Z");
  });
});

describe("the handler registry", () => {
  it("finds a registered handler and refuses a second one with the same type", () => {
    registerHandler({
      type: "test.unit.echo",
      queue: "default",
      schema: z.object({ text: z.string() }),
      run: async () => undefined,
    });
    expect(findHandler("test.unit.echo")?.queue).toBe("default");
    expect(findHandler("test.unit.nothing")).toBeUndefined();
    expect(() =>
      registerHandler({
        type: "test.unit.echo",
        queue: "default",
        schema: z.object({}),
        run: async () => undefined,
      }),
    ).toThrow(/registered twice/);
    expect(registeredTypes()).toContain("test.unit.echo");
  });
});
