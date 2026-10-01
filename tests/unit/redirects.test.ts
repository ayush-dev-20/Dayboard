import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/redirects";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths, with query strings", () => {
    expect(safeNextPath("/tasks")).toBe("/tasks");
    expect(safeNextPath("/notes/abc?view=list#top")).toBe("/notes/abc?view=list#top");
  });

  it("falls back for missing or empty input", () => {
    expect(safeNextPath(null)).toBe("/today");
    expect(safeNextPath(undefined)).toBe("/today");
    expect(safeNextPath("")).toBe("/today");
    expect(safeNextPath("", "")).toBe("");
  });

  it.each([
    ["absolute URL", "https://evil.example/steal"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["embedded backslash", "/ok\\..\\evil"],
    ["javascript scheme", "javascript:alert(1)"],
    ["no leading slash", "tasks"],
    ["control character", "/tasks\n/evil"],
    ["tab", "/\tevil"],
    ["API route", "/api/auth/sign-out"],
    ["sign-in loop", "/sign-in"],
    ["sign-up loop", "/sign-up?next=/x"],
  ])("rejects %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/today");
  });

  it("rejects very long values", () => {
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/today");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("https://evil.example", "/inbox")).toBe("/inbox");
  });
});
