import { describe, expect, it } from "vitest";
import { canUnlink, isSessionFresh, LAST_METHOD_MESSAGE } from "@/lib/auth-methods";

describe("canUnlink", () => {
  it("refuses to remove the only linked method", () => {
    expect(canUnlink(["google"], "google")).toBe(false);
    expect(canUnlink(["credential"], "credential")).toBe(false);
  });

  it("allows removing a method when another remains", () => {
    expect(canUnlink(["credential", "google"], "google")).toBe(true);
    expect(canUnlink(["google", "github"], "github")).toBe(true);
  });

  it("refuses a method that isn't linked", () => {
    expect(canUnlink(["google"], "github")).toBe(false);
    expect(canUnlink([], "google")).toBe(false);
  });

  it("explains the rule in plain words", () => {
    expect(LAST_METHOD_MESSAGE).toBe(
      "You can't remove your last sign-in method. Add another one first.",
    );
  });
});

describe("isSessionFresh", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("is fresh within the window", () => {
    expect(isSessionFresh(new Date("2026-10-01T11:55:00Z"), 600, now)).toBe(true);
    expect(isSessionFresh(new Date("2026-10-01T11:50:00Z"), 600, now)).toBe(true); // exactly 10 min
  });

  it("is stale beyond the window", () => {
    expect(isSessionFresh(new Date("2026-10-01T11:49:59Z"), 600, now)).toBe(false);
    expect(isSessionFresh(new Date("2026-09-30T12:00:00Z"), 600, now)).toBe(false);
  });
});
