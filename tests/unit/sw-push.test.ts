import { describe, expect, it } from "vitest";
import { decideClick, GENERIC_PUSH, notificationFor, parsePush, safePath } from "@/sw/push";

describe("reading a push payload", () => {
  const reminder = JSON.stringify({
    category: "TASK_REMINDER",
    title: "Dentist",
    body: "Due at 14:30",
    url: "/tasks?task=abc",
    tag: "reminder-1",
    reminderId: "r1",
    token: "v1.x.y",
  });

  it("reads a reminder", () => {
    expect(parsePush(reminder)).toEqual({
      title: "Dentist",
      body: "Due at 14:30",
      url: "/tasks?task=abc",
      tag: "reminder-1",
      token: "v1.x.y",
      reminderId: "r1",
    });
  });

  it("still shows something for a payload it cannot read", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "not json",
      "[]",
      "42",
      "null",
      "{}",
      '{"body":"no title"}',
      '{"title":"  "}',
    ]) {
      expect(parsePush(raw as string | null)).toEqual(GENERIC_PUSH);
    }
  });

  it("ignores fields of the wrong kind instead of failing", () => {
    const parsed = parsePush(
      JSON.stringify({ title: "Hi", body: 5, url: 5, tag: {}, token: [], reminderId: 1 }),
    );
    expect(parsed).toMatchObject({
      title: "Hi",
      body: "",
      url: "/today",
      tag: "dayboard",
      token: null,
      reminderId: null,
    });
  });

  it("follows only a path on this site", () => {
    expect(safePath("/tasks?task=1")).toBe("/tasks?task=1");
    expect(safePath("https://evil.example/x")).toBe("/today");
    expect(safePath("//evil.example/x")).toBe("/today");
    expect(safePath("/\\evil.example")).toBe("/today");
    expect(safePath("javascript:alert(1)")).toBe("/today");
    expect(safePath(undefined)).toBe("/today");
    expect(parsePush(JSON.stringify({ title: "Hi", url: "https://evil.example" })).url).toBe(
      "/today",
    );
  });
});

describe("building the notification", () => {
  it("offers Open and Snooze on a reminder, and nothing extra on the rest", () => {
    const reminder = notificationFor(
      parsePush(JSON.stringify({ title: "Dentist", token: "t", url: "/tasks?task=1" })),
    );
    expect(reminder.options.actions).toEqual([
      { action: "open", title: "Open" },
      { action: "snooze", title: "Snooze 15 min" },
    ]);
    expect(reminder.options.data).toEqual({ url: "/tasks?task=1", token: "t" });
    const review = notificationFor(
      parsePush(JSON.stringify({ title: "Your weekly review is ready", url: "/review" })),
    );
    expect(review.options.actions).toBeUndefined();
    expect(review.options.tag).toBe("dayboard");
  });
});

describe("what a click does", () => {
  it("opens the link", () => {
    expect(decideClick("", { url: "/tasks?task=1", token: "t" })).toEqual({
      kind: "open",
      url: "/tasks?task=1",
    });
    expect(decideClick("open", { url: "/review" })).toEqual({ kind: "open", url: "/review" });
  });

  it("snoozes only when asked and a token came with it", () => {
    expect(decideClick("snooze", { url: "/tasks?task=1", token: "t" })).toEqual({
      kind: "snooze",
      token: "t",
      url: "/tasks?task=1",
    });
    expect(decideClick("snooze", { url: "/review", token: null })).toEqual({
      kind: "open",
      url: "/review",
    });
    expect(decideClick("snooze", null)).toEqual({ kind: "open", url: "/today" });
  });

  it("never follows an address that is not on this site", () => {
    expect(decideClick("", { url: "https://evil.example" })).toEqual({
      kind: "open",
      url: "/today",
    });
  });
});
