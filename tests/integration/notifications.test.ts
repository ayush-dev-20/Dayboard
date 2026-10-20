import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeTask, updateTask } from "@/actions/tasks";
import { updatePreferences } from "@/actions/settings";
import {
  acknowledgeInApp,
  setNotificationPreferences,
  setQuietHours,
  setReminderDefaults,
  setTaskReminders,
  snoozeInApp,
} from "@/actions/notifications";
import { POST as heartbeatRoute } from "@/app/api/notifications/heartbeat/route";
import { DELETE as revokeRoute } from "@/app/api/notifications/subscriptions/[id]/route";
import { GET as devicesRoute } from "@/app/api/notifications/subscriptions/route";
import { POST as snoozeRoute } from "@/app/api/notifications/snooze/route";
import { POST as subscribeRoute } from "@/app/api/notifications/subscribe/route";
import { POST as testRoute } from "@/app/api/notifications/test/route";
import { GET as vapidRoute } from "@/app/api/notifications/vapid-key/route";
import { GET as dueRoute } from "@/app/api/notifications/reminders/route";
import { db } from "@/db/client";
import {
  calendarAccounts,
  calendarEvents,
  calendarSources,
  calendarTaskLinks,
  jobs,
  notificationLog,
  notificationPreferences,
  pushSubscriptions,
  taskReminders,
  tasks,
  userPreferences,
} from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday } from "@/lib/dates/today";
import { uuidv7 } from "@/lib/ids";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs } from "@/lib/jobs/claim";
import { runClaimed } from "@/lib/jobs/runner";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/lib/notifications/csrf";
import { deliverNotification } from "@/lib/notifications/deliver";
import {
  pruneNotifications,
  scanOverdueSummaries,
  scanReminders,
} from "@/lib/notifications/handlers";
import { notificationClock } from "@/lib/notifications/clock";
import { mockPush } from "@/lib/notifications/mock-sender";
import {
  dueInApp,
  reconcileTaskReminders,
  snoozeReminder,
  snoozeUntil,
} from "@/lib/notifications/reminders";
import { signSnoozeToken } from "@/lib/notifications/snooze-token";
import { registerSubscription, revokeDevice } from "@/lib/notifications/subscriptions";
import { env } from "@/lib/env";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";

// V2 feature 14 against a real database and the mock sender: ownership of devices, reminders that follow their
// tasks, delivery that happens once, and the person's choices (category, quiet hours, titles) taking effect.
// Times are worked out from today, so the tests do not go stale: a task is due three days from now at 09:00 UTC.

const APP = "http://localhost:3000";
const SECRET = env.BETTER_AUTH_SECRET;
const DAY = addDays(getUserToday({ timezone: "UTC", startOfDay: "00:00" }), 3);
/** 15 minutes before the due time, the default reminder. */
const REMIND = new Date(`${DAY}T08:45:00Z`);
/** A minute after it: when the worker looks. */
const AT = new Date(`${DAY}T08:46:00Z`);

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  ensureBuiltinHandlers();
  alice = await createTestUser("alice-push");
  bob = await createTestUser("bob-push");
});

beforeEach(async () => {
  mockPush.reset();
  actAs(alice);
  // The worker looks at everyone's reminders, and the database is shared with earlier tests: start each test with
  // nothing waiting, so what is sent is only what this test made.
  await db.update(taskReminders).set({ status: "CANCELLED" });
  await db
    .delete(jobs)
    .where(
      and(
        inArray(jobs.type, ["notification.deliver", "reminders.scan", "overdue.scan"]),
        inArray(jobs.status, ["QUEUED", "FAILED"]),
      ),
    );
});

afterAll(async () => {
  await db
    .delete(jobs)
    .where(inArray(jobs.type, ["notification.deliver", "reminders.scan", "overdue.scan"]));
});

async function makeTask(
  who: TestUser,
  over: Partial<typeof tasks.$inferInsert> = {},
  reconcile = true,
): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({
      userId: who.id,
      title: "Dentist",
      sortOrder: 0,
      status: "PLANNED",
      dueDate: DAY,
      dueTime: "09:00:00",
      ...over,
    })
    .returning({ id: tasks.id });
  if (reconcile) await reconcileTaskReminders(db, who.id, [row!.id]);
  return row!.id;
}
const remindersOf = (taskId: string) =>
  db.select().from(taskReminders).where(eq(taskReminders.taskId, taskId));
const logOf = (who: TestUser) =>
  db.select().from(notificationLog).where(eq(notificationLog.userId, who.id));
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

let endpointCount = 0;
async function device(who: TestUser, over: Partial<{ endpoint: string; deviceId: string }> = {}) {
  endpointCount += 1;
  return registerSubscription(
    who.id,
    {
      endpoint: over.endpoint ?? `https://push.example/${who.id}/${endpointCount}`,
      keys: { p256dh: "BPubKey12345678", auth: "AuthKey123456" },
      deviceId: over.deviceId ?? uuidv7(),
    },
    "Chrome on Mac",
  );
}
/** A device that has not been looked at for a while (so it is pushed to, not treated as open). */
async function quietDevice(who: TestUser) {
  const sub = await device(who);
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: new Date(Date.now() - 3_600_000) })
    .where(eq(pushSubscriptions.id, sub.id));
  return sub;
}
async function firstReminder(taskId: string) {
  const [row] = await remindersOf(taskId);
  return row!;
}
/** Runs the scan and every delivery job it queued, the way a worker does, with the clock at `now`. */
async function runWorker(now: Date) {
  notificationClock.now = () => now;
  try {
    await scanReminders(now);
    for (;;) {
      const claimed = await claimJobs("push-worker", ["notifications"], 20);
      if (claimed.length === 0) return;
      for (const job of claimed) await runClaimed("push-worker", job);
    }
  } finally {
    notificationClock.now = () => new Date();
  }
}
/** Runs every waiting delivery job, with the clock at `now`. */
async function drain(now: Date = new Date()) {
  notificationClock.now = () => now;
  try {
    for (;;) {
      const claimed = await claimJobs("push-worker", ["notifications"], 20);
      if (claimed.length === 0) return;
      for (const job of claimed) await runClaimed("push-worker", job);
    }
  } finally {
    notificationClock.now = () => new Date();
  }
}
const sentTo = (endpoint: string) => mockPush.sent.filter((s) => s.endpoint === endpoint);

describe("reminders follow their tasks", () => {
  it("makes one reminder 15 minutes before a task with a due time, and only one", async () => {
    const id = await makeTask(alice);
    await reconcileTaskReminders(db, alice.id, [id]);
    const rows = await remindersOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "DEFAULT_LEAD", status: "PENDING" });
    expect(iso(rows[0]!.remindAt)).toBe(REMIND.toISOString());
    expect(rows[0]!.spec).toEqual({ type: "before", minutes: 15 });
  });

  it("makes none for a task with only a date (no surprise 9:00 pings)", async () => {
    const id = await makeTask(alice, { dueTime: null });
    expect(await remindersOf(id)).toHaveLength(0);
  });

  it("makes none for a time that has already passed", async () => {
    const id = await makeTask(alice, { dueDate: addDays(DAY, -30) });
    expect(await remindersOf(id)).toHaveLength(0);
  });

  it("uses the start time when there is no due time", async () => {
    const id = await makeTask(alice, {
      dueDate: null,
      dueTime: null,
      startDate: DAY,
      startTime: "10:00:00",
    });
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T09:45:00.000Z`);
  });

  it("moves when the task's time changes, and starts again if it had been sent", async () => {
    const id = await makeTask(alice);
    const before = await firstReminder(id);
    await db
      .update(taskReminders)
      .set({ status: "SENT", sentAt: new Date() })
      .where(eq(taskReminders.id, before.id));
    await db.update(tasks).set({ dueTime: "11:00:00" }).where(eq(tasks.id, id));
    await reconcileTaskReminders(db, alice.id, [id]);
    const after = await firstReminder(id);
    expect(after.id).toBe(before.id);
    expect(iso(after.remindAt)).toBe(`${DAY}T10:45:00.000Z`);
    expect(after).toMatchObject({ status: "PENDING", sentAt: null });
  });

  it("goes away with the time, and is cancelled when the new time has passed", async () => {
    const id = await makeTask(alice);
    await db
      .update(tasks)
      .set({ dueDate: addDays(DAY, -30) })
      .where(eq(tasks.id, id));
    await reconcileTaskReminders(db, alice.id, [id]);
    expect((await firstReminder(id)).status).toBe("CANCELLED");
    await db.update(tasks).set({ dueTime: null, dueDate: DAY }).where(eq(tasks.id, id));
    await reconcileTaskReminders(db, alice.id, [id]);
    expect(await remindersOf(id)).toHaveLength(0);
  });

  it("is cancelled when the task is done, archived or deleted, and returns when it reopens", async () => {
    const id = await makeTask(alice);
    for (const closed of [
      { status: "DONE" as const, completedAt: new Date() },
      { archivedAt: new Date() },
      { deletedAt: new Date() },
    ]) {
      await db.update(tasks).set(closed).where(eq(tasks.id, id));
      await reconcileTaskReminders(db, alice.id, [id]);
      expect((await firstReminder(id)).status).toBe("CANCELLED");
      await db
        .update(tasks)
        .set({ status: "PLANNED", completedAt: null, archivedAt: null, deletedAt: null })
        .where(eq(tasks.id, id));
      await reconcileTaskReminders(db, alice.id, [id]);
      expect((await firstReminder(id)).status).toBe("PENDING");
    }
  });

  it("keeps a snooze through an unrelated change to the task", async () => {
    const id = await makeTask(alice);
    const row = await firstReminder(id);
    const until = new Date(Date.now() + 3_600_000);
    await snoozeReminder(alice.id, row.id, until);
    await db.update(tasks).set({ title: "Dentist (moved)" }).where(eq(tasks.id, id));
    await reconcileTaskReminders(db, alice.id, [id]);
    expect(await firstReminder(id)).toMatchObject({ status: "SNOOZED", snoozedUntil: until });
  });

  it("is brought in line by every way of changing a task, through the one helper they share", async () => {
    const id = await makeTask(alice, { dueTime: null, dueDate: null }, false);
    ok(await updateTask({ id, dueDate: DAY, dueTime: "14:30" }));
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T14:15:00.000Z`);
    ok(await updateTask({ id, dueTime: "16:00" }));
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T15:45:00.000Z`);
    ok(await completeTask({ id }));
    expect((await firstReminder(id)).status).toBe("CANCELLED");
  });

  it("moves every reminder when the person's time zone changes", async () => {
    const who = await createTestUser("tz-push");
    actAs(who);
    const id = await makeTask(who);
    expect(iso((await firstReminder(id)).remindAt)).toBe(REMIND.toISOString());
    ok(await updatePreferences({ timezone: "Asia/Kolkata" }));
    // 09:00 in Kolkata is 03:30 UTC, so the reminder is at 03:15 UTC.
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T03:15:00.000Z`);
  });

  it("follows the default lead the person chooses, and a category they switch off", async () => {
    const who = await createTestUser("lead-push");
    actAs(who);
    const id = await makeTask(who);
    ok(await setReminderDefaults({ leadMinutes: 60 }));
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T08:00:00.000Z`);
    ok(await setNotificationPreferences({ category: "TASK_REMINDER", enabled: false }));
    expect(await remindersOf(id)).toHaveLength(0);
    ok(await setNotificationPreferences({ category: "TASK_REMINDER", enabled: true }));
    expect(await remindersOf(id)).toHaveLength(1);
  });

  it("makes a reminder before a linked calendar event, and moves it when the event moves", async () => {
    expect(env.calendarAvailable).toBe(true);
    const who = await createTestUser("cal-push");
    const id = await makeTask(who, { dueTime: null, dueDate: null });
    const [account] = await db
      .insert(calendarAccounts)
      .values({
        userId: who.id,
        providerAccountId: `acc-${who.id}`,
        email: "cal@example.com",
        refreshTokenEnc: "x",
        scopes: [],
      })
      .returning();
    const [source] = await db
      .insert(calendarSources)
      .values({
        userId: who.id,
        accountId: account!.id,
        providerCalendarId: "p",
        name: "Personal",
        selected: true,
      })
      .returning();
    await db.insert(calendarEvents).values({
      userId: who.id,
      sourceId: source!.id,
      providerEventId: "ev1",
      title: "Review",
      startAt: new Date(`${DAY}T15:00:00Z`),
      endAt: new Date(`${DAY}T16:00:00Z`),
    });
    await db
      .insert(calendarTaskLinks)
      .values({ taskId: id, userId: who.id, sourceId: source!.id, providerEventId: "ev1" });
    await reconcileTaskReminders(db, who.id, [id]);
    expect(await remindersOf(id)).toMatchObject([{ kind: "CALENDAR_START", status: "PENDING" }]);
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T14:45:00.000Z`);

    await db
      .update(calendarEvents)
      .set({ startAt: new Date(`${DAY}T17:00:00Z`), endAt: new Date(`${DAY}T18:00:00Z`) })
      .where(eq(calendarEvents.userId, who.id));
    await reconcileTaskReminders(db, who.id, [id]);
    expect(iso((await firstReminder(id)).remindAt)).toBe(`${DAY}T16:45:00.000Z`);
  });
});

describe("custom reminders", () => {
  it("replaces the list, keeps the ones that did not change, and allows three", async () => {
    const id = await makeTask(alice);
    const first = ok(
      await setTaskReminders({
        taskId: id,
        reminders: [
          { type: "before", minutes: 30 },
          { type: "day-before", time: "18:00" },
        ],
      }),
    );
    expect(first.map((r) => r.label).sort()).toEqual(
      ["15 min before", "30 min before", "The evening before"].sort(),
    );
    const kept = first.find((r) => r.label === "30 min before")!;
    const second = ok(
      await setTaskReminders({
        taskId: id,
        reminders: [
          { type: "before", minutes: 30 },
          { type: "before", minutes: 60 },
        ],
      }),
    );
    expect(second.find((r) => r.label === "30 min before")!.id).toBe(kept.id);
    expect(second.some((r) => r.label === "The evening before")).toBe(false);

    const tooMany = await setTaskReminders({
      taskId: id,
      reminders: [
        { type: "at" },
        { type: "before", minutes: 5 },
        { type: "before", minutes: 15 },
        { type: "before", minutes: 60 },
      ],
    });
    expect(errorOf(tooMany).code).toBe("VALIDATION_ERROR");
  });

  it("refuses what cannot work: no time, a time that has passed, a bad spec, a finished or someone else's task", async () => {
    const dateOnly = await makeTask(alice, { dueTime: null });
    expect(
      errorOf(
        await setTaskReminders({ taskId: dateOnly, reminders: [{ type: "before", minutes: 15 }] }),
      ).message,
    ).toMatch(/time first/);
    // The evening before still works for a task with only a date.
    expect(
      ok(
        await setTaskReminders({
          taskId: dateOnly,
          reminders: [{ type: "day-before", time: "18:00" }],
        }),
      ),
    ).toHaveLength(1);

    const id = await makeTask(alice);
    expect(
      errorOf(
        await setTaskReminders({
          taskId: id,
          reminders: [{ type: "exact", date: addDays(DAY, -40), time: "09:00" }],
        }),
      ).message,
    ).toMatch(/passed/);
    expect(
      errorOf(
        await setTaskReminders({ taskId: id, reminders: [{ type: "event-start", minutes: 5 }] }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await setTaskReminders({ taskId: id, reminders: [{ type: "nope" }] })).code,
    ).toBe("VALIDATION_ERROR");

    await db.update(tasks).set({ status: "DONE", completedAt: new Date() }).where(eq(tasks.id, id));
    expect(errorOf(await setTaskReminders({ taskId: id, reminders: [{ type: "at" }] })).code).toBe(
      "VALIDATION_ERROR",
    );

    actAs(bob);
    const mine = await makeTask(alice);
    expect(
      errorOf(await setTaskReminders({ taskId: mine, reminders: [{ type: "at" }] })).code,
    ).toBe("NOT_FOUND");
  });

  it("moves a custom reminder with the task", async () => {
    const id = await makeTask(alice);
    ok(await setTaskReminders({ taskId: id, reminders: [{ type: "before", minutes: 60 }] }));
    await db.update(tasks).set({ dueTime: "12:00:00" }).where(eq(tasks.id, id));
    await reconcileTaskReminders(db, alice.id, [id]);
    const custom = (await remindersOf(id)).find((r) => r.kind === "CUSTOM")!;
    expect(iso(custom.remindAt)).toBe(`${DAY}T11:00:00.000Z`);
  });

  it("refuses a client-sent person", async () => {
    const id = await makeTask(alice);
    const result = await setTaskReminders({ taskId: id, userId: bob.id, reminders: [] });
    expect(errorOf(result).code).toBe("VALIDATION_ERROR");
  });
});

describe("devices belong to one person", () => {
  it("registers a device, and a new endpoint from the same device replaces the old", async () => {
    const who = await createTestUser("dev-a");
    const deviceId = uuidv7();
    const one = await device(who, { deviceId });
    const two = await device(who, { deviceId });
    expect(two.id).not.toBe(one.id);
    const live = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, who.id)));
    expect(live.filter((r) => !r.revokedAt)).toHaveLength(1);
    expect(live.find((r) => r.id === one.id)!.revokedAt).not.toBeNull();
  });

  it("refuses an endpoint another person owns, and leaves it with its owner", async () => {
    const endpoint = "https://push.example/shared-profile";
    const first = await device(alice, { endpoint });
    await expect(device(bob, { endpoint })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const [row] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row).toMatchObject({ id: first.id, userId: alice.id, revokedAt: null });
  });

  it("lists and revokes only the caller's devices", async () => {
    const mine = await device(alice);
    const theirs = await device(bob);
    actAs(alice);
    const list = (await (await devicesRoute()).json()) as { devices: { id: string }[] };
    expect(list.devices.map((d) => d.id)).toContain(mine.id);
    expect(list.devices.map((d) => d.id)).not.toContain(theirs.id);

    const refused = await revokeRoute(new Request(APP, { method: "DELETE" }), {
      params: Promise.resolve({ id: theirs.id }),
    });
    expect(refused.status).toBe(404);
    const [still] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, theirs.id));
    expect(still!.revokedAt).toBeNull();

    const done = await revokeRoute(new Request(APP, { method: "DELETE" }), {
      params: Promise.resolve({ id: mine.id }),
    });
    expect(done.status).toBe(200);
    const [gone] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, mine.id));
    expect(gone!.revokedAt).not.toBeNull();
    expect(
      (
        await revokeRoute(new Request(APP, { method: "DELETE" }), {
          params: Promise.resolve({ id: "not-an-id" }),
        })
      ).status,
    ).toBe(404);
  });

  it("signing out of a device removes its subscription, and only that person's", async () => {
    const who = await createTestUser("dev-out");
    const deviceId = uuidv7();
    await device(who, { deviceId });
    await device(bob, { deviceId });
    expect(await revokeDevice(who.id, deviceId)).toBe(1);
    expect(await revokeDevice(who.id, deviceId)).toBe(0);
    const [theirs] = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, bob.id), eq(pushSubscriptions.deviceId, deviceId)));
    expect(theirs!.revokedAt).toBeNull();
  });
});

describe("the subscribe route", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      endpoint: `https://push.example/route/${uuidv7()}`,
      keys: { p256dh: "BPubKey12345678", auth: "AuthKey123456" },
      deviceId: uuidv7(),
      ...over,
    });
  const post = (init: {
    origin?: string | null;
    token?: string | null;
    cookie?: string | null;
    body?: string;
  }) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    };
    if (init.origin !== null) headers.origin = init.origin ?? APP;
    if (init.token) headers[CSRF_HEADER] = init.token;
    if (init.cookie) headers.cookie = `${CSRF_COOKIE}=${encodeURIComponent(init.cookie)}`;
    return subscribeRoute(
      new Request(`${APP}/api/notifications/subscribe`, {
        method: "POST",
        headers,
        body: init.body ?? body(),
      }),
    );
  };

  it("hands out a key and a token, and saves a device that presents the token and our origin", async () => {
    const key = await vapidRoute();
    const data = (await key.json()) as { available: boolean; publicKey: string; csrf: string };
    expect(data.available).toBe(true);
    expect(data.publicKey).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    expect(key.headers.get("set-cookie")).toContain("HttpOnly");
    const res = await post({ token: data.csrf, cookie: data.csrf });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { device: { label: string } };
    expect(saved.device.label).toBe("Chrome on Android phone");
  });

  it("refuses another site, a missing or mismatched token, and a forged one", async () => {
    const token = issueCsrfToken(SECRET);
    expect((await post({ origin: "https://evil.example", token, cookie: token })).status).toBe(403);
    expect((await post({ origin: null, token, cookie: token })).status).toBe(403);
    expect((await post({ cookie: token })).status).toBe(403);
    expect((await post({ token })).status).toBe(403);
    expect((await post({ token, cookie: issueCsrfToken(SECRET) })).status).toBe(403);
    expect((await post({ token: "x.y", cookie: "x.y" })).status).toBe(403);
  });

  it("refuses a bad body and a person who is not signed in", async () => {
    const token = issueCsrfToken(SECRET);
    expect(
      (await post({ token, cookie: token, body: body({ endpoint: "http://insecure.example/x" }) }))
        .status,
    ).toBe(400);
    expect((await post({ token, cookie: token, body: body({ userId: bob.id }) })).status).toBe(400);
    expect((await post({ token, cookie: token, body: body({ deviceId: "nope" }) })).status).toBe(
      400,
    );
    actAs(null);
    expect((await post({ token, cookie: token })).status).toBe(401);
  });

  it("refuses an endpoint another person owns", async () => {
    const endpoint = `https://push.example/owned/${uuidv7()}`;
    await device(bob, { endpoint });
    const token = issueCsrfToken(SECRET);
    expect((await post({ token, cookie: token, body: body({ endpoint }) })).status).toBe(403);
  });
});

describe("delivery", () => {
  it("sends a due reminder once, to every device, with a link and a snooze token", async () => {
    const who = await createTestUser("send-a");
    actAs(who);
    const a = await quietDevice(who);
    const b = await quietDevice(who);
    const id = await makeTask(who);
    const reminder = await firstReminder(id);

    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(2);
    const sent = mockPush.sent[0]!.payload as Record<string, string>;
    expect(sent).toMatchObject({
      category: "TASK_REMINDER",
      title: "Dentist",
      body: "Due at 09:00",
      url: `/tasks?task=${id}`,
      reminderId: reminder.id,
    });
    expect(sent.token).toMatch(/^v1\./);
    expect(mockPush.sent[0]!.options.ttlSeconds).toBe(3600);
    expect(sentTo(a.id).length + sentTo(b.id).length).toBe(0); // keyed by endpoint, not id
    expect((await firstReminder(id)).status).toBe("SENT");
    const log = (await logOf(who)).filter((l) => l.dedupeKey.startsWith("reminder:"));
    expect(log).toMatchObject([{ status: "SENT", category: "TASK_REMINDER" }]);

    // Running everything again sends nothing more.
    await runWorker(new Date(AT.getTime() + 60_000));
    expect(mockPush.sent).toHaveLength(2);
  });

  it("is idempotent when the same delivery runs twice or two workers race", async () => {
    const who = await createTestUser("send-race");
    await quietDevice(who);
    const id = await makeTask(who);
    const row = await firstReminder(id);
    const payload = {
      category: "TASK_REMINDER" as const,
      dedupeKey: `reminder:${row.id}:${row.remindAt.getTime()}`,
      reminderId: row.id,
    };
    const first = await deliverNotification(who.id, payload, { now: AT });
    const second = await deliverNotification(who.id, payload, { now: AT });
    expect(first).toBe("sent");
    expect(second).toBe("already-handled");
    expect(mockPush.sent).toHaveLength(1);

    // The scan queues a reminder once even if it runs twice before a worker takes the job.
    const other = await createTestUser("send-race-2");
    await quietDevice(other);
    await makeTask(other);
    await scanReminders(AT);
    await scanReminders(AT);
    const queued = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, other.id), eq(jobs.type, "notification.deliver")));
    expect(queued).toHaveLength(1);
  });

  it("revokes a device the push service says is gone, and still reaches the others", async () => {
    const who = await createTestUser("send-gone");
    const gone = await quietDevice(who);
    const alive = await quietDevice(who);
    const [goneRow] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, gone.id));
    mockPush.failEndpoint(goneRow!.endpoint, 410);
    await makeTask(who);
    await runWorker(AT);
    const [after] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, gone.id));
    expect(after!.revokedAt).not.toBeNull();
    expect(mockPush.sent).toHaveLength(1);
    const [aliveRow] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, alive.id));
    expect(aliveRow!.revokedAt).toBeNull();
  });

  it("tries again after a server error, and sends once it recovers", async () => {
    const who = await createTestUser("send-5xx");
    const sub = await quietDevice(who);
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    mockPush.failEndpoint(row!.endpoint, 503);
    const id = await makeTask(who);
    await scanReminders(AT);
    notificationClock.now = () => AT;
    const claimed = await claimJobs("push-worker", ["notifications"], 20);
    const job = claimed.find((j) => j.userId === who.id)!;
    expect(job).toBeDefined();
    for (const other of claimed) {
      const outcome = await runClaimed("push-worker", other);
      if (other.id === job.id) expect(outcome).toBe("FAILED");
    }
    expect(mockPush.sent).toHaveLength(0);
    // Not logged as delivered, and still waiting: the retry (or the next scan) can still send it.
    expect((await logOf(who)).filter((l) => l.dedupeKey.startsWith("reminder:"))).toHaveLength(0);
    expect((await firstReminder(id)).status).toBe("PENDING");

    mockPush.reset();
    await db
      .update(jobs)
      .set({ runAt: new Date(0) })
      .where(eq(jobs.id, job.id));
    await drain(AT);
    expect(mockPush.sent).toHaveLength(1);
  });

  it("drops a reminder for a task that is done, and one that is long overdue", async () => {
    const who = await createTestUser("send-expire");
    await quietDevice(who);
    const doneId = await makeTask(who);
    await db
      .update(tasks)
      .set({ status: "DONE", completedAt: new Date() })
      .where(eq(tasks.id, doneId));
    // Nothing reconciled the task in this test, so the reminder is still waiting: delivery checks the task itself.
    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(0);
    expect((await firstReminder(doneId)).status).toBe("CANCELLED");
    expect((await logOf(who)).some((l) => l.status === "EXPIRED")).toBe(true);

    const lateId = await makeTask(who, { title: "Late" });
    const late = await firstReminder(lateId);
    const outcome = await deliverNotification(
      who.id,
      {
        category: "TASK_REMINDER",
        dedupeKey: `reminder:${late.id}:${late.remindAt.getTime()}`,
        reminderId: late.id,
      },
      { now: new Date(REMIND.getTime() + 3 * 3_600_000) },
    );
    expect(outcome).toBe("expired");
    expect((await firstReminder(lateId)).status).toBe("CANCELLED");
    expect(mockPush.sent).toHaveLength(0);
  });

  it("shows nothing but a generic line when titles are off", async () => {
    const who = await createTestUser("send-titles");
    actAs(who);
    await quietDevice(who);
    ok(await setReminderDefaults({ showTitles: false }));
    await makeTask(who, { title: "Secret surgery" });
    await runWorker(AT);
    const payload = mockPush.sent[0]!.payload as Record<string, string>;
    expect(payload.title).toBe("A task is due soon");
    expect(JSON.stringify(mockPush.sent)).not.toContain("Secret surgery");
    expect(JSON.stringify(mockPush.sent)).not.toContain("09:00");
  });

  it("does not push to a device whose app is open; the in-app reminder stands in", async () => {
    const who = await createTestUser("send-open");
    const open = await device(who);
    // Its tab was active a few seconds before the reminder came due.
    await db
      .update(pushSubscriptions)
      .set({ lastSeenAt: new Date(AT.getTime() - 10_000) })
      .where(eq(pushSubscriptions.id, open.id));
    const id = await makeTask(who);
    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(0);
    expect((await logOf(who)).filter((l) => l.dedupeKey.startsWith("reminder:"))).toMatchObject([
      { status: "SUPPRESSED_OPEN" },
    ]);
    expect(open.id).toBeTruthy();
    expect((await firstReminder(id)).status).toBe("SENT");
    // It shows in the app until it is dealt with.
    expect((await dueInApp(who.id, AT)).map((r) => r.title)).toEqual(["Dentist"]);
  });

  it("leaves a person with no device to the in-app reminder, and logs nothing", async () => {
    const who = await createTestUser("send-none");
    const id = await makeTask(who);
    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(0);
    expect(await logOf(who)).toHaveLength(0);
    expect((await firstReminder(id)).status).toBe("SENT");
    expect(await dueInApp(who.id, AT)).toHaveLength(1);
  });

  it("sends nothing in a category that is off, and logs it", async () => {
    const who = await createTestUser("send-pref");
    actAs(who);
    await quietDevice(who);
    const id = await makeTask(who);
    // Switched off after the reminder was made: the reminder is still there when it comes due.
    await db
      .insert(notificationPreferences)
      .values({ userId: who.id, category: "TASK_REMINDER", enabled: false });
    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(0);
    expect((await logOf(who)).filter((l) => l.dedupeKey.startsWith("reminder:"))).toMatchObject([
      { status: "SUPPRESSED_PREF" },
    ]);
    expect((await firstReminder(id)).status).toBe("CANCELLED");
  });

  it("holds a reminder in quiet hours and delivers it when they end", async () => {
    const who = await createTestUser("send-quiet");
    actAs(who);
    await quietDevice(who);
    // 08:30 to 10:00 UTC is quiet; the reminder is due at 08:45.
    ok(await setQuietHours({ quiet: { start: "08:30", end: "10:00" } }));
    const id = await makeTask(who);
    await runWorker(AT);
    expect(mockPush.sent).toHaveLength(0);
    const held = await firstReminder(id);
    expect(held).toMatchObject({ status: "SNOOZED" });
    expect(iso(held.snoozedUntil)).toBe(`${DAY}T10:00:00.000Z`);
    expect((await logOf(who)).some((l) => l.status === "SUPPRESSED_QUIET")).toBe(true);

    // Nothing at 09:30 (still quiet), and the reminder goes out just after 10:00.
    await runWorker(new Date(`${DAY}T09:30:00Z`));
    expect(mockPush.sent).toHaveLength(0);
    await runWorker(new Date(`${DAY}T10:01:00Z`));
    expect(mockPush.sent).toHaveLength(1);
    expect((await firstReminder(id)).status).toBe("SENT");
  });

  it("holds a quiet-hours window that crosses midnight, in the person's own time zone", async () => {
    const who = await createTestUser("send-quiet-tz");
    actAs(who);
    await setPreferences(who.id, { timezone: "Asia/Kolkata" });
    await quietDevice(who);
    ok(await setQuietHours({ quiet: { start: "22:00", end: "07:00" } }));
    // 09:00 in Kolkata: reminder 03:15 UTC = 08:45 local, outside the window.
    await makeTask(who);
    await runWorker(new Date(`${DAY}T03:16:00Z`));
    expect(mockPush.sent).toHaveLength(1);
  });

  it("sends a reminder before a linked event as a calendar reminder", async () => {
    const who = await createTestUser("send-cal");
    await quietDevice(who);
    const id = await makeTask(who, { dueTime: null, dueDate: null });
    const [account] = await db
      .insert(calendarAccounts)
      .values({
        userId: who.id,
        providerAccountId: `a-${who.id}`,
        email: "c@example.com",
        refreshTokenEnc: "x",
        scopes: [],
      })
      .returning();
    const [source] = await db
      .insert(calendarSources)
      .values({
        userId: who.id,
        accountId: account!.id,
        providerCalendarId: "p",
        name: "P",
        selected: true,
      })
      .returning();
    await db.insert(calendarEvents).values({
      userId: who.id,
      sourceId: source!.id,
      providerEventId: "e",
      title: "Design review",
      startAt: new Date(`${DAY}T15:00:00Z`),
      endAt: new Date(`${DAY}T16:00:00Z`),
    });
    await db
      .insert(calendarTaskLinks)
      .values({ taskId: id, userId: who.id, sourceId: source!.id, providerEventId: "e" });
    await reconcileTaskReminders(db, who.id, [id]);
    await runWorker(new Date(`${DAY}T14:46:00Z`));
    expect(mockPush.sent[0]!.payload).toMatchObject({
      category: "CALENDAR_REMINDER",
      body: "Event at 15:00",
    });
  });
});

describe("snooze", () => {
  async function sentReminder(label: string) {
    const who = await createTestUser(label);
    actAs(who);
    await quietDevice(who);
    const id = await makeTask(who);
    await runWorker(AT);
    const token = (mockPush.sent[0]!.payload as { token: string }).token;
    return { who, id, token, reminder: await firstReminder(id) };
  }
  const post = (token: string) =>
    snoozeRoute(
      new Request(`${APP}/api/notifications/snooze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );

  it("snoozes from the notification once, 15 minutes on, and the reminder comes back", async () => {
    const { token, id, who } = await sentReminder("snooze-a");
    const before = Date.now();
    expect((await post(token)).status).toBe(200);
    const row = await firstReminder(id);
    expect(row.status).toBe("SNOOZED");
    expect(row.snoozedUntil!.getTime()).toBeGreaterThanOrEqual(before + 14 * 60_000);
    // The same token cannot snooze it again.
    expect((await post(token)).status).toBe(409);

    // At the new time it is delivered again, with a fresh token.
    mockPush.reset();
    await runWorker(new Date(row.snoozedUntil!.getTime() + 1000));
    expect(mockPush.sent).toHaveLength(1);
    const next = (mockPush.sent[0]!.payload as { token: string }).token;
    expect(next).not.toBe(token);
    expect((await post(token)).status).toBe(409); // the old one still does nothing
    expect(who.id).toBeTruthy();
  });

  it("refuses a token for someone else, a forged one, an expired one, and no session", async () => {
    const { token, reminder, who } = await sentReminder("snooze-b");
    actAs(bob);
    expect((await post(token)).status).toBe(403);
    actAs(who);
    expect((await post("v1.abc.def")).status).toBe(403);
    const old = signSnoozeToken(
      { reminderId: reminder.id, userId: who.id, stamp: reminder.sentAt!.getTime() },
      SECRET,
      new Date(Date.now() - 2 * 3_600_000),
    );
    expect((await post(old)).status).toBe(403);
    actAs(null);
    expect((await post(token)).status).toBe(401);
    expect((await firstReminder(reminder.taskId)).status).toBe("SENT");
  });

  it("snoozes and dismisses from the app, and brings a snoozed reminder back when it is due", async () => {
    const who = await createTestUser("snooze-app");
    actAs(who);
    const id = await makeTask(who);
    const row = await firstReminder(id);
    const now = new Date();
    await db
      .update(taskReminders)
      .set({ status: "SENT", sentAt: now, remindAt: new Date(now.getTime() - 60_000) })
      .where(eq(taskReminders.id, row.id));
    expect(await dueInApp(who.id, now)).toHaveLength(1);

    ok(await snoozeInApp({ id: row.id, choice: "1h" }));
    expect(await dueInApp(who.id, now)).toHaveLength(0);
    const later = new Date(now.getTime() + 61 * 60_000);
    expect(await dueInApp(who.id, later)).toHaveLength(1);

    ok(await acknowledgeInApp({ id: row.id }));
    expect(await dueInApp(who.id, later)).toHaveLength(0);

    actAs(bob);
    expect(errorOf(await snoozeInApp({ id: row.id, choice: "15m" })).code).toBe("NOT_FOUND");
    expect(errorOf(await acknowledgeInApp({ id: row.id })).code).toBe("NOT_FOUND");
  });

  it("works out tomorrow morning at the person's work start in their own zone", async () => {
    const who = await createTestUser("snooze-tomorrow");
    await setPreferences(who.id, { timezone: "Asia/Kolkata", workStart: "08:30:00" });
    const until = await snoozeUntil(who.id, "tomorrow", new Date("2026-10-20T20:00:00Z"));
    // 20:00 UTC is already 01:30 on the 21st in Kolkata, so tomorrow is the 22nd: 08:30 IST = 03:00 UTC.
    expect(until.toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });
});

describe("the in-app list", () => {
  it("lists due reminders for the signed-in person only", async () => {
    const who = await createTestUser("inapp-a");
    actAs(who);
    const id = await makeTask(who);
    await db
      .update(taskReminders)
      .set({ remindAt: new Date(Date.now() - 60_000) })
      .where(eq(taskReminders.taskId, id));
    const res = await dueRoute();
    const data = (await res.json()) as { reminders: { title: string }[] };
    expect(data.reminders.map((r) => r.title)).toEqual(["Dentist"]);
    actAs(bob);
    expect(((await (await dueRoute()).json()) as { reminders: unknown[] }).reminders).toHaveLength(
      0,
    );
  });
});

describe("the overdue summary", () => {
  const MORNING = new Date(`${DAY}T06:45:00Z`); // start of day 06:00 + 45 minutes, in UTC

  async function summaryPerson(label: string) {
    const who = await createTestUser(label);
    actAs(who);
    ok(await setNotificationPreferences({ category: "OVERDUE_SUMMARY", enabled: true }));
    await quietDevice(who);
    return who;
  }
  it("is off unless the person asks for it", async () => {
    const who = await createTestUser("sum-off");
    await quietDevice(who);
    await makeTask(who, { dueDate: addDays(DAY, -2), dueTime: null }, false);
    expect(await scanOverdueSummaries(MORNING)).toBe(0);
  });

  it("goes out once a day with counts only, half an hour after the day starts", async () => {
    const who = await summaryPerson("sum-a");
    await makeTask(who, { title: "Late invoice", dueDate: addDays(DAY, -2), dueTime: null }, false);
    await makeTask(who, { title: "Today's thing", dueDate: DAY, dueTime: null }, false);

    expect(await scanOverdueSummaries(new Date(`${DAY}T06:10:00Z`))).toBe(0); // too early
    expect(await scanOverdueSummaries(MORNING)).toBeGreaterThanOrEqual(1);
    await drain(MORNING);
    expect(mockPush.sent).toHaveLength(1);
    expect(mockPush.sent[0]!.payload).toMatchObject({
      category: "OVERDUE_SUMMARY",
      body: "1 overdue, 1 due today",
      url: "/today",
    });
    expect(mockPush.sent[0]!.options.ttlSeconds).toBe(6 * 3600);
    expect(JSON.stringify(mockPush.sent)).not.toContain("Late invoice");

    // Nothing more that day, however often the scan looks, and not once the window has closed.
    expect(await scanOverdueSummaries(new Date(`${DAY}T07:00:00Z`))).toBe(0);
    await drain(MORNING);
    expect(mockPush.sent).toHaveLength(1);
  });

  it("says nothing when there is nothing to say", async () => {
    await summaryPerson("sum-empty");
    await scanOverdueSummaries(MORNING);
    await drain(MORNING);
    expect(mockPush.sent).toHaveLength(0);
    expect(await scanOverdueSummaries(new Date(`${DAY}T07:00:00Z`))).toBe(0);
  });

  it("is dropped, not held, in quiet hours", async () => {
    const who = await summaryPerson("sum-quiet");
    ok(await setQuietHours({ quiet: { start: "22:00", end: "07:00" } }));
    await makeTask(who, { dueDate: addDays(DAY, -2), dueTime: null }, false);
    await scanOverdueSummaries(MORNING);
    await drain(MORNING);
    // The job runs at the real time of day; force the case with the delivery function itself.
    const outcome = await deliverNotification(
      who.id,
      { category: "OVERDUE_SUMMARY", dedupeKey: `overdue:${DAY}-quiet-test`, date: DAY },
      { now: MORNING },
    );
    expect(outcome).toBe("suppressed-quiet");
    expect(mockPush.sent).toHaveLength(0);
    expect((await logOf(who)).some((l) => l.status === "SUPPRESSED_QUIET")).toBe(true);
  });
});

describe("other features' notifications", () => {
  it("sends the weekly review once, and not when its category is off", async () => {
    const who = await createTestUser("review-n");
    actAs(who);
    await quietDevice(who);
    const reviewId = uuidv7();
    await enqueueNotification(db, {
      userId: who.id,
      category: "WEEKLY_REVIEW_READY",
      dedupeKey: `review:${reviewId}`,
      reviewId,
    });
    await enqueueNotification(db, {
      userId: who.id,
      category: "WEEKLY_REVIEW_READY",
      dedupeKey: `review:${reviewId}`,
      reviewId,
    });
    await drain();
    expect(mockPush.sent).toHaveLength(1);
    expect(mockPush.sent[0]!.payload).toMatchObject({
      category: "WEEKLY_REVIEW_READY",
      url: "/review",
    });

    ok(await setNotificationPreferences({ category: "WEEKLY_REVIEW_READY", enabled: false }));
    mockPush.reset();
    const next = uuidv7();
    await enqueueNotification(db, {
      userId: who.id,
      category: "WEEKLY_REVIEW_READY",
      dedupeKey: `review:${next}`,
      reviewId: next,
    });
    await drain();
    expect(mockPush.sent).toHaveLength(0);
    expect((await logOf(who)).at(-1)).toBeDefined();
  });

  it("holds a review notification in quiet hours and sends it when they end", async () => {
    const who = await createTestUser("review-quiet");
    actAs(who);
    await quietDevice(who);
    // Quiet around the clock but for one minute is awkward; use "now" explicitly through the delivery function.
    ok(await setQuietHours({ quiet: { start: "20:00", end: "07:00" } }));
    const reviewId = uuidv7();
    const payload = {
      category: "WEEKLY_REVIEW_READY" as const,
      dedupeKey: `review:${reviewId}`,
      reviewId,
    };
    const outcome = await deliverNotification(who.id, payload, {
      now: new Date(`${DAY}T23:00:00Z`),
    });
    expect(outcome).toBe("held");
    const [held] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, who.id), eq(jobs.dedupeKey, `review:${reviewId}:held`)));
    expect(iso(held!.runAt)).toBe(`${addDays(DAY, 1)}T07:00:00.000Z`);
    expect(mockPush.sent).toHaveLength(0);
    // When it runs after the window, it is sent under the original key.
    expect(
      await deliverNotification(who.id, payload, { now: new Date(`${addDays(DAY, 1)}T07:01:00Z`) }),
    ).toBe("sent");
  });
});

describe("test notifications and housekeeping", () => {
  const sendTestTo = (subscriptionId: string) =>
    testRoute(
      new Request(`${APP}/api/notifications/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      }),
    );

  it("sends a test to the person's own device, three an hour", async () => {
    const who = await createTestUser("test-n");
    actAs(who);
    const sub = await device(who);
    for (let i = 0; i < 3; i++) expect((await sendTestTo(sub.id)).status).toBe(200);
    expect(mockPush.sent).toHaveLength(3);
    expect(mockPush.sent[0]!.payload).toMatchObject({ title: "Notifications work" });
    expect((await sendTestTo(sub.id)).status).toBe(429);
    expect(mockPush.sent).toHaveLength(3);
  });

  it("will not send a test to someone else's device", async () => {
    const theirs = await device(bob);
    actAs(alice);
    expect((await sendTestTo(theirs.id)).status).toBe(409);
    expect(mockPush.sent).toHaveLength(0);
  });

  it("revokes a device that answers 410 to a test", async () => {
    const who = await createTestUser("test-gone");
    actAs(who);
    const sub = await device(who);
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    mockPush.failEndpoint(row!.endpoint, 410);
    expect((await sendTestTo(sub.id)).status).toBe(409);
    const [after] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, sub.id));
    expect(after!.revokedAt).not.toBeNull();
  });

  it("records heartbeats for the caller's device only", async () => {
    const who = await createTestUser("hb");
    actAs(who);
    const mine = await quietDevice(who);
    const theirs = await quietDevice(bob);
    const beat = (deviceId: string) =>
      heartbeatRoute(
        new Request(`${APP}/api/notifications/heartbeat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceId }),
        }),
      );
    expect((await beat(mine.deviceId)).status).toBe(204);
    expect((await beat(theirs.deviceId)).status).toBe(204);
    const [m] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, mine.id));
    const [t] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, theirs.id));
    expect(Date.now() - m!.lastSeenAt.getTime()).toBeLessThan(10_000);
    expect(Date.now() - t!.lastSeenAt.getTime()).toBeGreaterThan(30 * 60_000);
  });

  it("prunes the log after 30 days, old finished reminders, and old revoked devices", async () => {
    const who = await createTestUser("prune-n");
    const old = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(notificationLog).values([
      {
        userId: who.id,
        category: "TASK_REMINDER",
        dedupeKey: "old",
        status: "SENT",
        createdAt: old,
      },
      { userId: who.id, category: "TASK_REMINDER", dedupeKey: "new", status: "SENT" },
    ]);
    const id = await makeTask(who);
    await db
      .update(taskReminders)
      .set({ status: "SENT", remindAt: old })
      .where(eq(taskReminders.taskId, id));
    const sub = await device(who);
    await db
      .update(pushSubscriptions)
      .set({ revokedAt: old })
      .where(eq(pushSubscriptions.id, sub.id));
    await pruneNotifications();
    expect((await logOf(who)).map((l) => l.dedupeKey)).toEqual(["new"]);
    expect(await remindersOf(id)).toHaveLength(0);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)),
    ).toHaveLength(0);
  });

  it("keeps the whole log free of text: ids, categories and statuses only", async () => {
    const who = await createTestUser("log-n");
    await quietDevice(who);
    await makeTask(who, { title: "Private title" });
    await runWorker(AT);
    expect(JSON.stringify(await logOf(who))).not.toContain("Private title");
    expect(Object.keys((await logOf(who))[0]!).sort()).toEqual(
      [
        "category",
        "createdAt",
        "dedupeKey",
        "errorCode",
        "id",
        "status",
        "subscriptionId",
        "userId",
      ].sort(),
    );
  });
});

describe("settings", () => {
  it("refuses bad quiet hours and a client-sent person, and clears quiet hours", async () => {
    actAs(alice);
    expect(errorOf(await setQuietHours({ quiet: { start: "22:00", end: "22:00" } })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await setQuietHours({ quiet: { start: "25:00", end: "07:00" } })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      errorOf(await setQuietHours({ quiet: { start: "22:00", end: "07:00" }, userId: bob.id }))
        .code,
    ).toBe("VALIDATION_ERROR");
    expect(errorOf(await setReminderDefaults({ leadMinutes: 5000 })).code).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await setNotificationPreferences({ category: "MARKETING", enabled: true })).code,
    ).toBe("VALIDATION_ERROR");
    ok(await setQuietHours({ quiet: { start: "22:00", end: "07:00" } }));
    ok(await setQuietHours({ quiet: null }));
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, alice.id));
    expect(prefs).toMatchObject({ quietHoursStart: null, quietHoursEnd: null });
  });

  it("changes only the caller's own switches", async () => {
    const who = await createTestUser("sw-a");
    actAs(who);
    ok(await setNotificationPreferences({ category: "OVERDUE_SUMMARY", enabled: true }));
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, [who.id, bob.id]));
    expect(rows).toMatchObject([{ userId: who.id, category: "OVERDUE_SUMMARY", enabled: true }]);
  });
});
