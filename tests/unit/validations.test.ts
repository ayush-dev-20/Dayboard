import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  deleteAccountSchema,
  onboardingSchema,
  revokeSessionSchema,
  unlinkProviderSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "@/lib/validations/settings";

describe("updatePreferencesSchema", () => {
  it("accepts any subset of editable preferences", () => {
    expect(updatePreferencesSchema.parse({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(
      updatePreferencesSchema.parse({
        timezone: "Asia/Kolkata",
        startOfDay: "06:30",
        weekStart: 1,
      }),
    ).toMatchObject({ weekStart: 1 });
  });

  it("rejects a client-sent userId instead of ignoring it", () => {
    const result = updatePreferencesSchema.safeParse({ theme: "dark", userId: "someone-else" });
    expect(result.success).toBe(false);
  });

  it("rejects other protected columns", () => {
    expect(updatePreferencesSchema.safeParse({ onboardedAt: new Date() }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ focusTaskId: "x" }).success).toBe(false);
  });

  it("validates each field", () => {
    expect(updatePreferencesSchema.safeParse({ theme: "sepia" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ timezone: "Mars/Base" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ startOfDay: "6am" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ startOfDay: "24:00" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ weekStart: 7 }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ weekStart: 1.5 }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ defaultTaskPriority: "URGENT" }).success).toBe(
      false,
    );
    expect(updatePreferencesSchema.safeParse({ aiEnabled: "yes" }).success).toBe(false);
  });
});

describe("profile and onboarding", () => {
  it("trims names and enforces 1 to 80 characters", () => {
    expect(updateProfileSchema.parse({ name: "  Ayush  " })).toEqual({ name: "Ayush" });
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("needs a valid time zone and theme", () => {
    const ok = { name: "Ayush", timezone: "Asia/Kolkata", theme: "system" };
    expect(onboardingSchema.safeParse(ok).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...ok, timezone: "nope" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...ok, theme: "neon" }).success).toBe(false);
  });
});

describe("password and security schemas", () => {
  it("enforces 10 to 128 characters and nothing else", () => {
    const ok = { currentPassword: "old", newPassword: "x".repeat(10) };
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...ok, newPassword: "x".repeat(9) }).success).toBe(
      false,
    );
    expect(changePasswordSchema.safeParse({ ...ok, newPassword: "x".repeat(129) }).success).toBe(
      false,
    );
  });

  it("requires the exact word DELETE", () => {
    expect(deleteAccountSchema.safeParse({ confirmation: "DELETE" }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirmation: "delete" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirmation: "DELETE " }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
  });

  it("only accepts known providers and non-empty session ids", () => {
    expect(unlinkProviderSchema.safeParse({ provider: "google" }).success).toBe(true);
    expect(unlinkProviderSchema.safeParse({ provider: "credential" }).success).toBe(false);
    expect(revokeSessionSchema.safeParse({ sessionId: "" }).success).toBe(false);
  });
});
