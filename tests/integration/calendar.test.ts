import { and, eq, inArray, like, notLike } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as callbackRoute } from "@/app/api/calendar/google/callback/route";
import { GET as connectRoute } from "@/app/api/calendar/google/connect/route";
import { GET as eventsRoute, POST as createEventRoute } from "@/app/api/calendar/events/route";
import { POST as selectRoute } from "@/app/api/calendar/calendars/route";
import { POST as syncRoute } from "@/app/api/calendar/sync/route";
import { DELETE as disconnectRoute } from "@/app/api/calendar/account/route";
import { GET as statusRoute } from "@/app/api/calendar/status/route";
import { createTask, updateTask } from "@/actions/tasks";
import { db } from "@/db/client";
import {
  calendarAccounts,
  calendarEvents,
  calendarSources,
  calendarTaskLinks,
  jobs,
} from "@/db/schema";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs } from "@/lib/jobs/claim";
import { runClaimed } from "@/lib/jobs/runner";
import { createOauthCookie, OAUTH_COOKIE } from "@/lib/calendar/oauth";
import { mockCalendar, fixtureEvents } from "@/lib/calendar/providers/mock";
import { syncAccount } from "@/lib/calendar/sync";
import { MANUAL_SYNCS_PER_HOUR } from "@/lib/calendar/manual";
import { planningCalendar } from "@/lib/calendar/planning";
import { openToken } from "@/lib/calendar/crypto";
import { calendarKeys } from "@/lib/calendar/keyring";
import { actAs, createTestUser, ok, type TestUser } from "./harness";

// V2 feature 12 against the real routes and database, with the mock provider: the connect flow and its checks,
// encrypted tokens, sync (insert, update, delete, 410, invalid_grant), ownership, and disconnect.

let alice: TestUser;
let bob: TestUser;
const SECRET = "integration-tests-only-secret-0123456789abcdef";
const APP = "http://localhost:3000";

const cookieHeader = (value: string) => ({ cookie: `${OAUTH_COOKIE}=${value}` });

/** Runs the whole connect flow as `person`: the redirect to the provider, then the callback with its code. */
async function connect(person: TestUser, options: { write?: boolean } = {}) {
  actAs(person);
  const start = await connectRoute(
    new Request(`${APP}/api/calendar/google/connect${options.write ? "?write=1" : ""}`),
  );
  expect(start.status).toBe(307);
  const target = new URL(start.headers.get("location")!);
  const cookie = /dayboard_calendar_oauth=([^;]+)/.exec(start.headers.get("set-cookie") ?? "")![1]!;
  const done = await callbackRoute(
    new Request(`${APP}/api/calendar/google/callback?${target.searchParams.toString()}`, {
      headers: cookieHeader(cookie),
    }),
  );
  return { done, target, cookie };
}

const outcome = (response: Response) =>
  new URL(response.headers.get("location")!).searchParams.get("calendar");

async function accountOf(person: TestUser) {
  return (
    await db.select().from(calendarAccounts).where(eq(calendarAccounts.userId, person.id))
  )[0];
}

beforeAll(async () => {
  ensureBuiltinHandlers();
  alice = await createTestUser("alice-cal");
  bob = await createTestUser("bob-cal");
});
beforeEach(() => {
  mockCalendar.reset();
});
afterAll(async () => {
  await db.delete(jobs).where(like(jobs.type, "calendar.%"));
});

describe("connecting", () => {
  it("sends the person to the provider with a signed state cookie that expires, and stores a sealed token", async () => {
    const { done, target, cookie } = await connect(alice);
    expect(outcome(done)).toBe("connected");
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(cookie.split(".")).toHaveLength(2);
    // The callback clears the cookie.
    expect(done.headers.get("set-cookie")).toMatch(/dayboard_calendar_oauth=;/);

    const account = await accountOf(alice);
    expect(account).toMatchObject({
      email: "mock.person@example.com",
      status: "ACTIVE",
      provider: "GOOGLE",
    });
    expect(account!.scopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
    // Stored encrypted: not the token itself, and it opens only for its owner.
    expect(account!.refreshTokenEnc).toMatch(/^v1\./);
    expect(account!.refreshTokenEnc).not.toContain("mock-refresh");
    expect(
      openToken(
        account!.refreshTokenEnc,
        calendarKeys(),
        `${alice.id}:${account!.providerAccountId}`,
      ),
    ).toBe("mock-refresh");
    expect(() =>
      openToken(
        account!.refreshTokenEnc,
        calendarKeys(),
        `${bob.id}:${account!.providerAccountId}`,
      ),
    ).toThrow();

    const sources = await db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.accountId, account!.id));
    expect(sources.map((s) => [s.name, s.selected]).sort()).toEqual([
      ["Personal", true],
      ["Work", false],
    ]);
    // The first sync is queued.
    expect(
      (await db.select().from(jobs).where(eq(jobs.type, "calendar.sync"))).some(
        (j) => j.userId === alice.id,
      ),
    ).toBe(true);
  });

  it("refuses a callback with the wrong state, no cookie, a cookie made for someone else, or a reused code", async () => {
    actAs(alice);
    const start = await connectRoute(new Request(`${APP}/api/calendar/google/connect`));
    const target = new URL(start.headers.get("location")!);
    const cookie = /dayboard_calendar_oauth=([^;]+)/.exec(
      start.headers.get("set-cookie") ?? "",
    )![1]!;
    const params = target.searchParams;
    const call = (query: string, headers: Record<string, string> = {}) =>
      callbackRoute(new Request(`${APP}/api/calendar/google/callback?${query}`, { headers }));

    const badState = await call(`code=${params.get("code")}&state=wrong`, cookieHeader(cookie));
    expect(outcome(badState)).toBe("failed");
    expect(outcome(await call(params.toString()))).toBe("failed"); // no cookie

    const forBob = createOauthCookie({ userId: bob.id, wantsWrite: false }, SECRET);
    expect(
      outcome(await call(`code=mock-code&state=${forBob.state}`, cookieHeader(forBob.cookie))),
    ).toBe("failed");

    expect(outcome(await call(params.toString(), cookieHeader(cookie)))).toBe("connected");
    // The same code and verifier again: refused.
    expect(outcome(await call(params.toString(), cookieHeader(cookie)))).toBe("failed");
  });

  it("treats a person who said no at Google as a quiet outcome, and needs a signed-in person", async () => {
    actAs(alice);
    const denied = await callbackRoute(
      new Request(`${APP}/api/calendar/google/callback?error=access_denied`),
    );
    expect(outcome(denied)).toBe("denied");

    actAs(null);
    const anon = await connectRoute(new Request(`${APP}/api/calendar/google/connect`));
    expect(anon.headers.get("location")).toContain("/sign-in");
  });

  it("asks for the write scope only when it is requested, as its own step", async () => {
    const plain = await connect(bob);
    expect(outcome(plain.done)).toBe("connected");
    expect((await accountOf(bob))!.scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );

    const upgrade = await connect(bob, { write: true });
    expect(outcome(upgrade.done)).toBe("connected");
    expect((await accountOf(bob))!.scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
    // Reconnecting the same Google account updates it; it does not make a second row.
    expect(
      await db.select().from(calendarAccounts).where(eq(calendarAccounts.userId, bob.id)),
    ).toHaveLength(1);
  });
});

describe("syncing", () => {
  async function connected(person: TestUser) {
    await connect(person);
    return (await accountOf(person))!;
  }

  it("reads the selected calendar's events into the cache, and only that calendar", async () => {
    const account = await connected(await createTestUser("sync-a"));
    const out = await syncAccount(account.id);
    expect(out).toMatchObject({ status: "synced" });
    const rows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, account.userId));
    expect(rows.map((r) => r.title).sort()).toContain("Design review");
    expect(rows.some((r) => r.title === "Roadmap sync")).toBe(false); // "Work" is not selected
    expect(rows.find((r) => r.title === "Team offsite")).toMatchObject({
      allDay: true,
      busy: false,
    });
    expect(rows.find((r) => r.title.startsWith("Maybe"))).toMatchObject({ status: "tentative" });
    const [after] = await db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(after!.lastSyncedAt).not.toBeNull();
    expect(after!.syncLeaseUntil).toBeNull();
  });

  it("updates an event that changed, removes ones the provider reports gone, and keeps the rest", async () => {
    const account = await connected(await createTestUser("sync-b"));
    await syncAccount(account.id);
    const original = fixtureEvents("primary");
    mockCalendar.behaviour.events = {
      // p-2 is gone from the window as well as reported removed, as a real calendar would answer.
      primary: original
        .filter((e) => e.providerEventId !== "p-2")
        .map((e) => (e.providerEventId === "p-1" ? { ...e, title: "Design review (moved)" } : e)),
    };
    mockCalendar.behaviour.removedIds = ["p-2"];
    const out = await syncAccount(account.id);
    expect(out).toMatchObject({ status: "synced", removed: 1 });
    const titles = (
      await db.select().from(calendarEvents).where(eq(calendarEvents.userId, account.userId))
    ).map((r) => r.title);
    expect(titles).toContain("Design review (moved)");
    expect(titles).not.toContain("Design review");
    expect(titles.some((t) => t.startsWith("Maybe"))).toBe(false);
    expect(mockCalendar.calls.filter((c) => c.method === "listEvents").at(-1)?.syncToken).toMatch(
      /^mock-sync-/,
    );
  });

  it("a sync token that expired (410) triggers a full read, and an event gone from the window is removed", async () => {
    const account = await connected(await createTestUser("sync-c"));
    await syncAccount(account.id);
    mockCalendar.behaviour.expireSyncToken = true;
    mockCalendar.behaviour.events = {
      primary: fixtureEvents("primary").filter((e) => e.providerEventId !== "p-5"),
    };
    const out = await syncAccount(account.id);
    expect(out.status).toBe("synced");
    const calls = mockCalendar.calls.filter((c) => c.method === "listEvents");
    expect(calls.at(-2)?.syncToken).toBeDefined();
    expect(calls.at(-1)?.syncToken).toBeUndefined();
    const ids = (
      await db.select().from(calendarEvents).where(eq(calendarEvents.userId, account.userId))
    ).map((r) => r.providerEventId);
    expect(ids).not.toContain("p-5");
  });

  it("invalid_grant marks the account NEEDS_RECONNECT, keeps the cached events, and breaks nothing else", async () => {
    const person = await createTestUser("sync-d");
    const account = await connected(person);
    await syncAccount(account.id);
    mockCalendar.behaviour.invalidGrant = true;
    expect(await syncAccount(account.id)).toEqual({ status: "needs_reconnect" });
    const [row] = await db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(row).toMatchObject({
      status: "NEEDS_RECONNECT",
      lastError: "INVALID_GRANT",
      syncLeaseUntil: null,
    });

    actAs(person);
    const events = await eventsRoute(
      new Request(`${APP}/api/calendar/events?from=2020-01-01&to=2099-01-01`),
    );
    // The window is too long for a range request; the cache itself is still there.
    expect(events.status).toBe(400);
    expect(
      (await db.select().from(calendarEvents).where(eq(calendarEvents.userId, person.id))).length,
    ).toBeGreaterThan(0);
    // A later sync is a no-op while it needs reconnecting.
    expect(await syncAccount(account.id)).toEqual({ status: "busy" });
  });

  it("another sync holding the account's lease makes this one step aside; a temporary failure is retried", async () => {
    const account = await connected(await createTestUser("sync-e"));
    await db
      .update(calendarAccounts)
      .set({ syncLeaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(calendarAccounts.id, account.id));
    expect(await syncAccount(account.id)).toEqual({ status: "busy" });

    await db
      .update(calendarAccounts)
      .set({ syncLeaseUntil: null })
      .where(eq(calendarAccounts.id, account.id));
    mockCalendar.behaviour.failWith = "UNAVAILABLE";
    await expect(syncAccount(account.id)).rejects.toThrow();
    const [row] = await db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(row).toMatchObject({ lastError: "UNAVAILABLE", status: "ACTIVE", syncLeaseUntil: null });
  });

  it("runs as a job: the scheduled job queues one sync per account, and each takes its person from the job", async () => {
    const person = await createTestUser("sync-f");
    const account = await connected(person);
    await db.delete(jobs).where(like(jobs.type, "calendar.%"));
    // Other test files leave due jobs of their own in the shared database. They would fill the claim limit ahead
    // of these, so they are set aside first.
    await db
      .update(jobs)
      .set({ status: "CANCELLED" })
      .where(and(inArray(jobs.status, ["QUEUED", "FAILED"]), notLike(jobs.type, "calendar.%")));
    // An explicit past time: the database clock has microseconds, the claim compares with milliseconds.
    const past = new Date(Date.now() - 1000);
    await db.insert(jobs).values({ type: "calendar.sync_all", payload: {}, runAt: past });
    const [all] = await claimJobs("w", ["default"], 5);
    expect(all!.type).toBe("calendar.sync_all");
    expect(await runClaimed("w", all!)).toBe("SUCCEEDED");
    const queued = await db.select().from(jobs).where(eq(jobs.type, "calendar.sync"));
    expect(queued.filter((j) => j.userId === person.id)).toHaveLength(1);

    const [one] = (await claimJobs("w", ["default"], 200)).filter((j) => j.userId === person.id);
    expect(await runClaimed("w", one!)).toBe("SUCCEEDED");
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.userId, person.id));
    expect(rows.length).toBeGreaterThan(0);

    // A job that names someone else's account does nothing: the account must belong to the job's person.
    const other = await createTestUser("sync-g");
    await db.insert(jobs).values({
      type: "calendar.sync",
      payload: { accountId: account.id },
      userId: other.id,
      runAt: past,
    });
    const claimedNow = (await claimJobs("w", ["default"], 200)).filter(
      (j) => j.userId === other.id,
    );
    const [stray] = claimedNow;
    mockCalendar.calls = [];
    expect(await runClaimed("w", stray!)).toBe("SUCCEEDED");
    expect(mockCalendar.calls).toEqual([]);
  });
});

describe("reading, ownership and disconnecting", () => {
  it("events and status are the signed-in person's own; another person's ids are not found", async () => {
    const a = await createTestUser("own-a");
    const b = await createTestUser("own-b");
    await connect(a);
    await syncAccount((await accountOf(a))!.id);
    await connect(b);

    actAs(a);
    const today = new Date().toISOString().slice(0, 10);
    const mine = await (
      await eventsRoute(new Request(`${APP}/api/calendar/events?from=${today}&to=${today}`))
    ).json();
    expect(mine.events.length).toBeGreaterThan(0);
    expect(mine.events[0]).not.toHaveProperty("userId");

    actAs(b);
    const theirs = await (
      await eventsRoute(new Request(`${APP}/api/calendar/events?from=${today}&to=${today}`))
    ).json();
    expect(theirs.events).toEqual([]); // b has not synced
    const status = await (await statusRoute()).json();
    expect(status.accounts).toHaveLength(1);
    expect(JSON.stringify(status)).not.toMatch(/refresh|token|mock-refresh/i);

    const aSource = (
      await db.select().from(calendarSources).where(eq(calendarSources.userId, a.id))
    )[0]!;
    const post = (path: typeof selectRoute, body: unknown) =>
      path(
        new Request(`${APP}/api/calendar/x`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await post(selectRoute, { sourceId: aSource.id, selected: false })).status).toBe(404);
    const aAccount = (await accountOf(a))!;
    const del = await disconnectRoute(
      new Request(`${APP}/api/calendar/account`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: aAccount.id }),
      }),
    );
    expect(del.status).toBe(404);
    expect(await accountOf(a)).toBeDefined();
  });

  it("validates the range, and turning a calendar off removes its cached events at once", async () => {
    const person = await createTestUser("own-c");
    await connect(person);
    await syncAccount((await accountOf(person))!.id);
    actAs(person);
    expect(
      (await eventsRoute(new Request(`${APP}/api/calendar/events?from=2026-10-10&to=2026-09-01`)))
        .status,
    ).toBe(400);
    expect(
      (await eventsRoute(new Request(`${APP}/api/calendar/events?from=nope&to=nope`))).status,
    ).toBe(400);
    expect(
      (await eventsRoute(new Request(`${APP}/api/calendar/events?from=2026-01-01&to=2026-06-01`)))
        .status,
    ).toBe(400);

    const source = (
      await db.select().from(calendarSources).where(eq(calendarSources.userId, person.id))
    ).find((s) => s.selected)!;
    const off = await selectRoute(
      new Request(`${APP}/api/calendar/calendars`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, selected: false }),
      }),
    );
    expect(off.status).toBe(200);
    expect(
      await db.select().from(calendarEvents).where(eq(calendarEvents.userId, person.id)),
    ).toHaveLength(0);
  });

  it("disconnecting revokes, and deletes the account, calendars, events and waiting jobs", async () => {
    const person = await createTestUser("own-d");
    await connect(person);
    const account = (await accountOf(person))!;
    await syncAccount(account.id);
    expect(
      (await db.select().from(jobs).where(eq(jobs.userId, person.id))).some(
        (j) => j.type === "calendar.sync" && j.status === "QUEUED",
      ),
    ).toBe(true);

    actAs(person);
    const res = await disconnectRoute(
      new Request(`${APP}/api/calendar/account`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockCalendar.calls.some((c) => c.method === "revoke")).toBe(true);
    expect(await accountOf(person)).toBeUndefined();
    expect(
      await db.select().from(calendarSources).where(eq(calendarSources.userId, person.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(calendarEvents).where(eq(calendarEvents.userId, person.id)),
    ).toHaveLength(0);
    const waiting = (await db.select().from(jobs).where(eq(jobs.userId, person.id))).filter(
      (j) => j.type === "calendar.sync",
    );
    expect(waiting.every((j) => j.status === "CANCELLED")).toBe(true);
  });

  it("'Sync now' reads right away, and stops after six an hour", async () => {
    const person = await createTestUser("own-e");
    await connect(person);
    actAs(person);
    const call = () =>
      syncRoute(
        new Request(`${APP}/api/calendar/sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
    const first = await call();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ synced: 1, needsReconnect: false });
    expect(
      (await db.select().from(calendarEvents).where(eq(calendarEvents.userId, person.id))).length,
    ).toBeGreaterThan(0);
    for (let i = 1; i < MANUAL_SYNCS_PER_HOUR; i++) expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });
});

describe("planning with the calendar", () => {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const at = (hh: string) => new Date(`${todayUtc}T${hh}:00.000Z`);
  const timed = (id: string, title: string, from: string, to: string, extra: object = {}) => ({
    providerEventId: id,
    icalUid: null,
    title,
    location: null,
    startAt: at(from),
    endAt: at(to),
    allDay: false,
    timeZone: null,
    busy: true,
    status: "confirmed" as const,
    htmlLink: null,
    recurringEventId: null,
    updatedAt: new Date(),
    ...extra,
  });
  const options = (extra: object = {}) => ({
    today: todayUtc,
    timeZone: "UTC",
    workStart: "09:00",
    workEnd: "18:00",
    seesTitles: false,
    now: at("00:00"),
    ...extra,
  });

  async function syncedWith(label: string) {
    const person = await createTestUser(label);
    await connect(person);
    mockCalendar.behaviour.events = {
      primary: [
        timed("a", "Board meeting", "10:00", "11:00"),
        timed("b", "Maybe lunch", "14:00", "15:00", { status: "tentative" }),
        timed("c", "Out of office note", "12:00", "13:00", { busy: false }),
        {
          ...timed("d", "Holiday", "00:00", "00:00"),
          allDay: true,
          startAt: at("00:00"),
          endAt: new Date(at("00:00").getTime() + 86_400_000),
          busy: false,
        },
      ],
    };
    await syncAccount((await accountOf(person))!.id);
    return person;
  }

  it("gives the free stretches of the working day, counting tentative as busy and free events as free", async () => {
    const person = await syncedWith("plan-a");
    const result = await planningCalendar(person.id, options());
    expect(result?.freeWindows).toEqual(["09:00–10:00", "11:00–14:00", "15:00–18:00"]);
  });

  it("never includes event titles unless the person allowed it", async () => {
    const person = await syncedWith("plan-b");
    const off = await planningCalendar(person.id, options());
    expect(off).not.toHaveProperty("events");
    expect(JSON.stringify(off)).not.toContain("Board meeting");

    const on = await planningCalendar(person.id, options({ seesTitles: true }));
    expect(on?.events).toEqual(
      expect.arrayContaining(["10:00 Board meeting", "14:00 Maybe lunch"]),
    );
  });

  it("changes nothing for a person with no calendar, with none selected, or with the calendar off", async () => {
    const none = await createTestUser("plan-c");
    expect(await planningCalendar(none.id, options())).toBeUndefined();

    const person = await syncedWith("plan-d");
    for (const source of await db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.userId, person.id))) {
      await db
        .update(calendarSources)
        .set({ selected: false })
        .where(eq(calendarSources.id, source.id));
    }
    expect(await planningCalendar(person.id, options())).toBeUndefined();
  });

  it("only sees the person's own events", async () => {
    await syncedWith("plan-e");
    const stranger = await createTestUser("plan-f");
    await connect(stranger);
    // Connected but not synced: nothing booked, so the whole working day is free.
    const result = await planningCalendar(stranger.id, options());
    expect(result?.freeWindows).toEqual(["09:00–18:00"]);
  });
});

describe("creating an event from a task", () => {
  const body = (taskId: string, sourceId: string, extra: object = {}) => ({
    taskId,
    sourceId,
    start: "2026-10-20T10:00:00.000Z",
    end: "2026-10-20T10:30:00.000Z",
    idempotencyKey: "confirm-0001",
    ...extra,
  });
  const post = (payload: unknown) =>
    createEventRoute(
      new Request(`${APP}/api/calendar/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  const primary = async (person: TestUser) =>
    (await db.select().from(calendarSources).where(eq(calendarSources.userId, person.id))).find(
      (s) => s.selected,
    )!;

  it("refuses without the write scope, and makes nothing at Google", async () => {
    const person = await createTestUser("create-a");
    await connect(person);
    actAs(person);
    const task = ok(await createTask({ title: "Plan the trip" }));
    const res = await post(body(task.id, (await primary(person)).id));
    expect(res.status).toBe(403);
    expect(mockCalendar.created).toEqual([]);
  });

  it("creates the event once after confirmation, links it to the task, and a retry makes no second one", async () => {
    const person = await createTestUser("create-b");
    await connect(person, { write: true });
    actAs(person);
    const task = ok(await createTask({ title: "Plan the trip" }));
    const source = await primary(person);

    const first = await post(body(task.id, source.id));
    expect(first.status).toBe(201);
    expect(mockCalendar.created).toEqual([
      { calendarId: source.providerCalendarId, title: "Plan the trip" },
    ]);
    const links = await db
      .select()
      .from(calendarTaskLinks)
      .where(eq(calendarTaskLinks.taskId, task.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ userId: person.id, sourceId: source.id });

    const again = await post(body(task.id, source.id));
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
    expect(mockCalendar.created).toHaveLength(1);
    expect(
      await db.select().from(calendarTaskLinks).where(eq(calendarTaskLinks.taskId, task.id)),
    ).toHaveLength(1);

    // A different confirmation is a different event.
    expect((await post(body(task.id, source.id, { idempotencyKey: "confirm-0002" }))).status).toBe(
      201,
    );
    expect(mockCalendar.created).toHaveLength(2);
  });

  it("never changes the event when the task is changed afterwards", async () => {
    const person = await createTestUser("create-c");
    await connect(person, { write: true });
    actAs(person);
    const task = ok(await createTask({ title: "Move me", dueDate: "2026-10-20" }));
    await post(body(task.id, (await primary(person)).id));
    mockCalendar.calls = [];
    ok(await updateTask({ id: task.id, dueDate: "2026-10-25" }));
    expect(mockCalendar.calls.filter((c) => c.method === "createEvent")).toEqual([]);
    expect(mockCalendar.created).toHaveLength(1);
  });

  it("checks both ids belong to the person, and the times", async () => {
    const a = await createTestUser("create-d");
    const b = await createTestUser("create-e");
    await connect(a, { write: true });
    await connect(b, { write: true });
    actAs(b);
    const bobsTask = ok(await createTask({ title: "Bob's" }));
    actAs(a);
    const mine = ok(await createTask({ title: "Mine" }));

    expect((await post(body(bobsTask.id, (await primary(a)).id))).status).toBe(404);
    expect((await post(body(mine.id, (await primary(b)).id))).status).toBe(404);
    expect(
      (await post(body(mine.id, (await primary(a)).id, { end: "2026-10-20T09:00:00.000Z" })))
        .status,
    ).toBe(400);
    expect(
      (await post(body(mine.id, (await primary(a)).id, { end: "2026-10-22T10:30:00.000Z" })))
        .status,
    ).toBe(400);
    expect((await post({ ...body(mine.id, (await primary(a)).id), extra: 1 })).status).toBe(400);
    expect(mockCalendar.created).toEqual([]);
  });

  it("asks to reconnect when Google no longer accepts the connection", async () => {
    const person = await createTestUser("create-f");
    await connect(person, { write: true });
    actAs(person);
    const task = ok(await createTask({ title: "Needs Google" }));
    mockCalendar.behaviour.invalidGrant = true;
    const res = await post(body(task.id, (await primary(person)).id));
    expect(res.status).toBe(409);
    expect((await accountOf(person))!.status).toBe("NEEDS_RECONNECT");
    expect(mockCalendar.created).toEqual([]);
  });
});
