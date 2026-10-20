import { describe, expect, it } from "vitest";
import { deviceLabel } from "@/lib/notifications/device-label";
import { devicePushState, deviceStateMessage } from "@/lib/notifications/device-state";
import {
  CSRF_COOKIE,
  csrfTokenMatches,
  isSameOrigin,
  issueCsrfToken,
} from "@/lib/notifications/csrf";
import {
  MAX_PAYLOAD_BYTES,
  overdueSummaryPayload,
  reminderPayload,
  serializePayload,
  ttlSeconds,
} from "@/lib/notifications/payload";
import { inQuietHours, quietHoursEnd, quietHoursOf } from "@/lib/notifications/quiet-hours";
import {
  computeRemindAt,
  describeReminder,
  remindInstant,
  reminderSpecSchema,
  timedAnchor,
  type ReminderTask,
} from "@/lib/notifications/remind-at";
import { signSnoozeToken, verifySnoozeToken } from "@/lib/notifications/snooze-token";

const iso = (date: Date | null) => date?.toISOString() ?? null;
const task = (over: Partial<ReminderTask> = {}): ReminderTask => ({
  dueDate: "2026-10-20",
  dueTime: "14:30:00",
  startDate: null,
  startTime: null,
  ...over,
});
const NOW = new Date("2026-10-19T00:00:00Z");

describe("when a reminder fires", () => {
  it("counts back from the due time in the person's time zone", () => {
    const kolkata = { timezone: "Asia/Kolkata" };
    expect(iso(computeRemindAt({ type: "before", minutes: 15 }, task(), kolkata, NOW))).toBe(
      "2026-10-20T08:45:00.000Z",
    );
    expect(iso(computeRemindAt({ type: "at" }, task(), kolkata, NOW))).toBe(
      "2026-10-20T09:00:00.000Z",
    );
    expect(
      iso(computeRemindAt({ type: "before", minutes: 60 }, task(), { timezone: "UTC" }, NOW)),
    ).toBe("2026-10-20T13:30:00.000Z");
  });

  it("uses the start time when there is no due time", () => {
    const t = task({ dueTime: null, startDate: "2026-10-20", startTime: "08:00" });
    expect(timedAnchor(t)).toEqual({ date: "2026-10-20", time: "08:00" });
    expect(iso(computeRemindAt({ type: "at" }, t, { timezone: "UTC" }, NOW))).toBe(
      "2026-10-20T08:00:00.000Z",
    );
  });

  it("gives a task with only a date no time-based reminder (no surprise 9:00 pings)", () => {
    const dateOnly = task({ dueTime: null });
    expect(
      computeRemindAt({ type: "before", minutes: 15 }, dateOnly, { timezone: "UTC" }, NOW),
    ).toBeNull();
    expect(computeRemindAt({ type: "at" }, dateOnly, { timezone: "UTC" }, NOW)).toBeNull();
    // A reminder the evening or day before still works for a date.
    expect(
      iso(
        computeRemindAt({ type: "day-before", time: "18:00" }, dateOnly, { timezone: "UTC" }, NOW),
      ),
    ).toBe("2026-10-19T18:00:00.000Z");
  });

  it("means 9:00 on the wall clock the day before, across a daylight-saving change", () => {
    const spec = { type: "day-before", time: "09:00" } as const;
    const ny = "America/New_York";
    // Clocks went forward on 2027-03-14. The day before the 15th is the 14th: 09:00 EDT.
    expect(iso(remindInstant(spec, task({ dueDate: "2027-03-15" }), ny))).toBe(
      "2027-03-14T13:00:00.000Z",
    );
    // The day before the 14th is still winter: 09:00 EST.
    expect(iso(remindInstant(spec, task({ dueDate: "2027-03-14" }), ny))).toBe(
      "2027-03-13T14:00:00.000Z",
    );
    // Clocks went back in London on 2027-10-31.
    const london = "Europe/London";
    expect(iso(remindInstant(spec, task({ dueDate: "2027-11-01" }), london))).toBe(
      "2027-10-31T09:00:00.000Z",
    );
    expect(iso(remindInstant(spec, task({ dueDate: "2027-10-31" }), london))).toBe(
      "2027-10-30T08:00:00.000Z",
    );
  });

  it("keeps a lead steady across the change: 15 minutes before 03:00 is 15 minutes of real time", () => {
    const at = remindInstant(
      { type: "before", minutes: 15 },
      task({ dueDate: "2027-03-14", dueTime: "03:00" }),
      "America/New_York",
    );
    expect(iso(at)).toBe("2027-03-14T06:45:00.000Z");
  });

  it("does not make a reminder for a time that has passed, but can still say what the instant was", () => {
    const late = new Date("2026-10-20T14:00:00Z");
    const spec = { type: "before", minutes: 15 } as const;
    expect(computeRemindAt(spec, task(), { timezone: "UTC" }, late)).not.toBeNull();
    expect(
      computeRemindAt(spec, task(), { timezone: "UTC" }, new Date("2026-10-20T14:16:00Z")),
    ).toBeNull();
    expect(iso(remindInstant(spec, task(), "UTC"))).toBe("2026-10-20T14:15:00.000Z");
  });

  it("moves with the task: a changed date or time gives a new instant, and a new zone too", () => {
    const spec = { type: "before", minutes: 15 } as const;
    const before = iso(remindInstant(spec, task(), "UTC"));
    expect(iso(remindInstant(spec, task({ dueTime: "16:00" }), "UTC"))).not.toBe(before);
    expect(iso(remindInstant(spec, task({ dueDate: "2026-10-21" }), "UTC"))).not.toBe(before);
    expect(iso(remindInstant(spec, task(), "Asia/Tokyo"))).not.toBe(before);
  });

  it("follows a chosen date and time, and a calendar event's start", () => {
    expect(
      iso(
        remindInstant(
          { type: "exact", date: "2026-10-25", time: "07:30" },
          task({ dueDate: null, dueTime: null }),
          "UTC",
        ),
      ),
    ).toBe("2026-10-25T07:30:00.000Z");
    const start = new Date("2026-10-22T10:00:00Z");
    expect(iso(remindInstant({ type: "event-start", minutes: 10 }, task(), "UTC", start))).toBe(
      "2026-10-22T09:50:00.000Z",
    );
    expect(remindInstant({ type: "event-start", minutes: 10 }, task(), "UTC", null)).toBeNull();
  });

  it("checks what a spec may hold", () => {
    expect(reminderSpecSchema.safeParse({ type: "before", minutes: 15 }).success).toBe(true);
    expect(reminderSpecSchema.safeParse({ type: "before", minutes: -1 }).success).toBe(false);
    expect(reminderSpecSchema.safeParse({ type: "day-before", time: "25:00" }).success).toBe(false);
    expect(
      reminderSpecSchema.safeParse({ type: "exact", date: "2026-02-30", time: "07:00" }).success,
    ).toBe(false);
    expect(reminderSpecSchema.safeParse({ type: "other" }).success).toBe(false);
  });

  it("describes each reminder in words", () => {
    expect(describeReminder({ type: "before", minutes: 15 })).toBe("15 min before");
    expect(describeReminder({ type: "before", minutes: 60 })).toBe("1 hour before");
    expect(describeReminder({ type: "before", minutes: 0 })).toBe("At the time");
    expect(describeReminder({ type: "day-before", time: "18:00" })).toBe("The evening before");
    expect(describeReminder({ type: "day-before", time: "09:00" })).toBe("The day before at 09:00");
  });
});

describe("quiet hours", () => {
  const night = quietHoursOf("22:00:00", "07:00:00")!;
  const lunch = quietHoursOf("12:00", "13:30")!;

  it("is off unless both ends are set and differ", () => {
    expect(quietHoursOf(null, null)).toBeNull();
    expect(quietHoursOf("22:00", null)).toBeNull();
    expect(quietHoursOf("22:00", "22:00")).toBeNull();
    expect(night).toEqual({ start: "22:00", end: "07:00" });
  });

  it("holds a window that crosses midnight, in the person's time zone", () => {
    // 23:30 and 06:59 in London are quiet; 07:00 and 21:59 are not.
    expect(inQuietHours(night, "Europe/London", new Date("2026-12-01T23:30:00Z"))).toBe(true);
    expect(inQuietHours(night, "Europe/London", new Date("2026-12-02T06:59:00Z"))).toBe(true);
    expect(inQuietHours(night, "Europe/London", new Date("2026-12-02T07:00:00Z"))).toBe(false);
    expect(inQuietHours(night, "Europe/London", new Date("2026-12-01T21:59:00Z"))).toBe(false);
    // The same instant is a different local time elsewhere: 23:30 UTC is 05:00 in Kolkata, quiet; 02:00 UTC is 07:30 there, not.
    expect(inQuietHours(night, "Asia/Kolkata", new Date("2026-12-01T23:30:00Z"))).toBe(true);
    expect(inQuietHours(night, "Asia/Kolkata", new Date("2026-12-02T02:00:00Z"))).toBe(false);
  });

  it("holds a window within one day", () => {
    expect(inQuietHours(lunch, "UTC", new Date("2026-12-01T12:00:00Z"))).toBe(true);
    expect(inQuietHours(lunch, "UTC", new Date("2026-12-01T13:29:00Z"))).toBe(true);
    expect(inQuietHours(lunch, "UTC", new Date("2026-12-01T13:30:00Z"))).toBe(false);
  });

  it("says when the window ends: the next time the clock reads its end", () => {
    expect(iso(quietHoursEnd(night, "UTC", new Date("2026-12-01T23:30:00Z")))).toBe(
      "2026-12-02T07:00:00.000Z",
    );
    expect(iso(quietHoursEnd(night, "UTC", new Date("2026-12-02T03:00:00Z")))).toBe(
      "2026-12-02T07:00:00.000Z",
    );
    expect(iso(quietHoursEnd(night, "Asia/Kolkata", new Date("2026-12-01T23:30:00Z")))).toBe(
      "2026-12-02T01:30:00.000Z",
    );
  });

  it("is never quiet with no window", () => {
    expect(inQuietHours(null, "UTC", new Date())).toBe(false);
  });
});

describe("the notification payload", () => {
  const input = {
    taskId: "7b0f5a0e-0000-4000-8000-000000000001",
    taskTitle: "Dentist",
    showTitles: true,
    when: "Due at 14:30",
    reminderId: "r1",
    token: "tok",
  };

  it("shows the task and when it is due when titles are on", () => {
    const payload = reminderPayload(input);
    expect(payload).toMatchObject({
      category: "TASK_REMINDER",
      title: "Dentist",
      body: "Due at 14:30",
      url: `/tasks?task=${input.taskId}`,
      tag: "reminder-r1",
      reminderId: "r1",
      token: "tok",
    });
  });

  it("says nothing private when titles are off", () => {
    const json = JSON.stringify(reminderPayload({ ...input, showTitles: false }));
    expect(json).not.toContain("Dentist");
    expect(json).not.toContain("14:30");
    expect(reminderPayload({ ...input, showTitles: false }).title).toBe("A task is due soon");
  });

  it("names a calendar reminder's category and keeps a long title inside the size cap", () => {
    expect(reminderPayload({ ...input, calendar: true }).category).toBe("CALENDAR_REMINDER");
    const long = reminderPayload({ ...input, taskTitle: "x".repeat(5000) });
    expect([...long.title].length).toBeLessThanOrEqual(120);
    expect(new TextEncoder().encode(serializePayload(long)).length).toBeLessThanOrEqual(
      MAX_PAYLOAD_BYTES,
    );
    const wide = reminderPayload({ ...input, taskTitle: "😀".repeat(500) });
    expect(new TextEncoder().encode(serializePayload(wide)).length).toBeLessThanOrEqual(
      MAX_PAYLOAD_BYTES,
    );
  });

  it("summarises the overdue with counts only", () => {
    const payload = overdueSummaryPayload({
      overdue: 3,
      dueToday: 2,
      date: "2026-10-19",
      showTitles: true,
    });
    expect(payload.body).toBe("3 overdue, 2 due today");
    expect(payload.url).toBe("/today");
    expect(payload.tag).toBe("overdue-2026-10-19");
  });

  it("keeps a reminder for an hour and a summary for six", () => {
    expect(ttlSeconds("TASK_REMINDER")).toBe(3600);
    expect(ttlSeconds("CALENDAR_REMINDER")).toBe(3600);
    expect(ttlSeconds("OVERDUE_SUMMARY")).toBe(6 * 3600);
  });
});

describe("the snooze token", () => {
  const secret = "s".repeat(40);
  const claim = { reminderId: "r1", userId: "u1", stamp: Date.parse("2026-10-20T08:45:00Z") };
  const now = new Date("2026-10-20T08:45:00Z");

  it("round-trips for an hour", () => {
    const token = signSnoozeToken(claim, secret, now);
    expect(verifySnoozeToken(token, secret, now)).toEqual(claim);
    expect(verifySnoozeToken(token, secret, new Date(now.getTime() + 59 * 60_000))).toEqual(claim);
  });

  it("expires after an hour", () => {
    const token = signSnoozeToken(claim, secret, now);
    expect(verifySnoozeToken(token, secret, new Date(now.getTime() + 60 * 60_000))).toBeNull();
  });

  it("refuses another secret, a changed body, a changed signature and junk", () => {
    const token = signSnoozeToken(claim, secret, now);
    expect(verifySnoozeToken(token, "t".repeat(40), now)).toBeNull();
    const [v, body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ r: "r1", u: "someone-else", t: claim.stamp, e: now.getTime() + 1e6 }),
    ).toString("base64url");
    expect(verifySnoozeToken(`${v}.${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifySnoozeToken(`${v}.${body}.${sig!.slice(0, -2)}xx`, secret, now)).toBeNull();
    expect(verifySnoozeToken("nonsense", secret, now)).toBeNull();
    expect(verifySnoozeToken("", secret, now)).toBeNull();
    expect(verifySnoozeToken(`${token}.extra`, secret, now)).toBeNull();
  });
});

describe("the subscribe protection", () => {
  const secret = "c".repeat(40);

  it("accepts a cookie and header that match and that we issued", () => {
    const token = issueCsrfToken(secret);
    expect(csrfTokenMatches(token, token, secret)).toBe(true);
  });

  it("refuses a missing, mismatched or foreign token", () => {
    const token = issueCsrfToken(secret);
    expect(csrfTokenMatches(null, token, secret)).toBe(false);
    expect(csrfTokenMatches(token, null, secret)).toBe(false);
    expect(csrfTokenMatches(token, issueCsrfToken(secret), secret)).toBe(false);
    // Matching, but not signed by us (an attacker who can set both cannot make a valid one).
    expect(csrfTokenMatches("abc.def", "abc.def", secret)).toBe(false);
    expect(csrfTokenMatches(token, token, "d".repeat(40))).toBe(false);
  });

  it("uses a stable cookie name", () => {
    expect(CSRF_COOKIE).toBe("dayboard_push_csrf");
  });

  it("accepts only our own origin", () => {
    expect(isSameOrigin("https://app.example", null, "https://app.example")).toBe(true);
    expect(isSameOrigin(null, "https://app.example/settings", "https://app.example")).toBe(true);
    expect(isSameOrigin("https://evil.example", null, "https://app.example")).toBe(false);
    expect(isSameOrigin(null, null, "https://app.example")).toBe(false);
    expect(isSameOrigin(null, "not a url", "https://app.example")).toBe(false);
  });
});

describe("the device label", () => {
  it("names the browser and the device", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android phone");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
      ),
    ).toBe("Safari on Mac");
    expect(deviceLabel(null)).toBe("Browser on Unknown device");
  });
});

describe("what this device can do", () => {
  const base = {
    serverAvailable: true,
    hasPushApi: true,
    install: "menu" as const,
    permission: "default" as NotificationPermission,
    subscribed: false,
  };

  it("says the server has no push before anything about the browser", () => {
    expect(devicePushState({ ...base, serverAvailable: false, hasPushApi: false })).toBe(
      "server-off",
    );
  });

  it("explains iOS Safari outside the installed app, and an unsupported browser", () => {
    expect(
      devicePushState({ ...base, hasPushApi: false, install: "ios", permission: "unsupported" }),
    ).toBe("needs-install");
    expect(
      devicePushState({
        ...base,
        hasPushApi: false,
        install: "unsupported",
        permission: "unsupported",
      }),
    ).toBe("unsupported");
    expect(deviceStateMessage("needs-install")).toMatch(/16\.4/);
    expect(deviceStateMessage("needs-install")).toMatch(/Home Screen/);
  });

  it("tells blocked from off from on", () => {
    expect(devicePushState({ ...base, permission: "denied" })).toBe("blocked");
    expect(devicePushState(base)).toBe("off");
    expect(devicePushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
    // Permission was granted but the subscription is gone (cleared by the browser): offer to enable again.
    expect(devicePushState({ ...base, permission: "granted", subscribed: false })).toBe("off");
  });

  it("has a message for every state", () => {
    for (const state of [
      "checking",
      "server-off",
      "unsupported",
      "needs-install",
      "blocked",
      "off",
      "on",
    ] as const) {
      expect(deviceStateMessage(state).length).toBeGreaterThan(5);
    }
  });
});
