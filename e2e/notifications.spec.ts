import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  ageSubscriptions,
  findUser,
  insertPushSubscription,
  insertReminder,
  insertTask,
  makeReminderScanDue,
  notificationSettingsOf,
  notificationLogOf,
  pushSubscriptionsOf,
  remindersOf,
  setCategoryDb,
  setDayPrefs,
  setQuietHoursDb,
  taskByTitle,
} from "./db";
import { signUp, taskRow, today } from "./helpers";
import { pushesTo } from "./push-mailbox";

// V2 feature 14 end to end: Settings → Notifications with a fake subscription (headless Chromium has no push
// service), reminders on a task, the in-app reminders on Today, delivery through tick mode with the mock sender, and
// the honest messages where push cannot work. Notifications are never asked for before the button is pressed.

const TICK = { authorization: "Bearer e2e-tick-secret-0123456789abcdefghijkl" };

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  await setDayPrefs(user.id, "UTC", "00:00:00");
  return user;
}

/**
 * A page where the browser can "subscribe": a stand-in for the push service, which headless Chromium lacks. It keeps its
 * subscription in storage like a browser does, and counts how many times the page asked for permission.
 */
async function withFakePush(page: Page) {
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    const KEY = "e2e-push-endpoint";
    const w = window as unknown as { __permissionAsks: number };
    w.__permissionAsks = 0;
    const original = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args: []) => {
      w.__permissionAsks += 1;
      return original(...args);
    };
    const make = (endpoint: string) => ({
      endpoint,
      expirationTime: null,
      toJSON: () => ({ endpoint, keys: { p256dh: "BE2EPublicKey12345", auth: "E2EAuthKey1234" } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.subscribe = async () => {
      const endpoint = `https://push.example.test/e2e/${crypto.randomUUID()}`;
      localStorage.setItem(KEY, endpoint);
      return make(endpoint) as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async () => {
      const endpoint = localStorage.getItem(KEY);
      return endpoint ? (make(endpoint) as unknown as PushSubscription) : null;
    };
  });
}

const askedForPermission = (page: Page) =>
  page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks);
const deviceState = (page: Page) => page.getByTestId("device-state");

async function runJobs(page: Page) {
  await makeReminderScanDue();
  for (let i = 0; i < 3; i += 1) {
    const response = await page.request.post("/api/jobs/tick", { headers: TICK });
    expect(response.ok()).toBe(true);
  }
}

test.describe("Settings → Notifications", () => {
  test("enabling asks only after the click; the device appears, a test arrives, and revoking removes it", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await withFakePush(page);
    await page.goto("/settings/notifications");

    await expect(page.getByRole("heading", { name: "Notifications", level: 2 })).toBeVisible();
    await expect(deviceState(page)).toHaveAttribute("data-state", "off");
    // Nothing was asked for on load.
    expect(await askedForPermission(page)).toBe(0);
    await expect(page.getByText("No device receives notifications yet.")).toBeVisible();

    await page.getByRole("button", { name: "Enable notifications on this device" }).click();
    await expect(deviceState(page)).toHaveAttribute("data-state", "on");
    expect(await askedForPermission(page)).toBe(1);
    await expect(page.getByText("This device ·")).toBeVisible();
    const subs = await pushSubscriptionsOf(user.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.user_agent_label).toMatch(/Chrome on/);
    const endpoint = subs[0]!.endpoint;

    await page.getByRole("button", { name: "Send a test notification" }).click();
    await expect(page.getByText("Test sent.")).toBeVisible();
    await expect.poll(async () => (await pushesTo(endpoint)).length).toBe(1);
    expect((await pushesTo(endpoint))[0]!.payload).toMatchObject({ title: "Notifications work" });

    await page.reload();
    await expect(deviceState(page)).toHaveAttribute("data-state", "on");

    await page.getByRole("button", { name: /^Revoke / }).click();
    await expect(deviceState(page)).toHaveAttribute("data-state", "off");
    await expect(page.getByText("No device receives notifications yet.")).toBeVisible();
    expect((await pushSubscriptionsOf(user.id))[0]!.revoked).toBe(true);
  });

  test("signing out of the device unsubscribes it", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    await withFakePush(page);
    await page.goto("/settings/notifications");
    await page.getByRole("button", { name: "Enable notifications on this device" }).click();
    await expect(deviceState(page)).toHaveAttribute("data-state", "on");

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/sign-in/);
    await expect.poll(async () => (await pushSubscriptionsOf(user.id))[0]?.revoked).toBe(true);
  });

  test("the switches, the default reminder, titles and quiet hours are saved", async ({ page }) => {
    const user = await newUser(page);
    await page.goto("/settings/notifications");

    await page.getByRole("switch", { name: "Overdue summary" }).click();
    await page.getByRole("switch", { name: "Task reminders" }).click();
    await page.getByRole("switch", { name: "Show task titles in notifications" }).click();
    await page.getByLabel("Default reminder").selectOption("30");
    await page.getByRole("switch", { name: "Quiet hours" }).click();
    await page.getByLabel("Quiet hours from").fill("21:30");
    await page.getByLabel("Quiet hours to").fill("06:45");
    await page.getByLabel("Quiet hours to").blur();

    // Every change is saved on its own: wait for the last one before looking again.
    await expect
      .poll(async () => notificationSettingsOf(user.id))
      .toMatchObject({
        lead: 30,
        titles: false,
        quiet_start: "21:30",
        quiet_end: "06:45",
        categories: [
          { category: "OVERDUE_SUMMARY", enabled: true },
          { category: "TASK_REMINDER", enabled: false },
        ],
      });
    await page.reload();
    await expect(page.getByRole("switch", { name: "Overdue summary" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Task reminders" })).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Show task titles in notifications" }),
    ).not.toBeChecked();
    await expect(page.getByLabel("Default reminder")).toHaveValue("30");
    await expect(page.getByRole("switch", { name: "Quiet hours" })).toBeChecked();
    await expect(page.getByLabel("Quiet hours from")).toHaveValue("21:30");
    await expect(page.getByLabel("Quiet hours to")).toHaveValue("06:45");
    // Sync problems have no switch until sync status exists, and the weekly review has one.
    await expect(page.getByRole("switch", { name: "Sync problems" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Weekly review" })).toBeVisible();
    expect(user.id).toBeTruthy();
  });

  test("says what it can't do: iOS outside the installed app, and a browser with no push", async ({
    browser,
  }) => {
    test.slow();
    const noPush = () => {
      // Safari on iOS has no push outside an installed app: the API is simply absent.
      delete (window as unknown as { PushManager?: unknown }).PushManager;
    };
    const ios = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 800 },
    });
    const iosPage = await ios.newPage();
    await iosPage.addInitScript(noPush);
    await signUp(iosPage);
    await iosPage.goto("/settings/notifications");
    await expect(deviceState(iosPage)).toHaveAttribute("data-state", "needs-install");
    await expect(deviceState(iosPage)).toContainText("Home Screen");
    await expect(deviceState(iosPage)).toContainText("16.4");
    await expect(
      iosPage.getByRole("button", { name: "Enable notifications on this device" }),
    ).toHaveCount(0);
    await ios.close();

    const firefox = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
    });
    const plain = await firefox.newPage();
    await plain.addInitScript(noPush);
    await signUp(plain);
    await plain.goto("/settings/notifications");
    await expect(deviceState(plain)).toHaveAttribute("data-state", "unsupported");
    await expect(deviceState(plain)).toContainText("can't receive push notifications");
    await firefox.close();
  });

  test("a browser that blocks notifications says so", async ({ page }) => {
    await newUser(page);
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { get: () => "denied" });
    });
    await page.goto("/settings/notifications");
    await expect(deviceState(page)).toHaveAttribute("data-state", "blocked");
    await expect(deviceState(page)).toContainText("blocked for this site");
  });

  test("has no serious accessibility problems at 360px, light and dark", async ({ page }) => {
    test.slow();
    await newUser(page);
    await withFakePush(page);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/settings/notifications");
      await expect(deviceState(page)).toHaveAttribute("data-state", "off");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${scheme}: no sideways scroll`,
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${scheme}: ${v.id}`),
        JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
      ).toEqual([]);
    }
  });
});

test.describe("reminders on a task", () => {
  test("add one, change the time and it moves, finish the task and it goes", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertTask(user.id, { title: "Dentist", dueDate: today(3), dueTime: "14:30" });
    await page.goto(`/tasks/${id}`);

    await page.getByRole("button", { name: /^Remind me/ }).click();
    await page.getByRole("button", { name: "30 minutes before" }).click();
    const chips = page.getByRole("list", { name: "Reminders on this task" });
    await expect(chips.getByText("30 min before")).toBeVisible();
    await expect.poll(async () => (await remindersOf(id)).map((r) => r.kind)).toContain("CUSTOM");
    const at = async () =>
      (await remindersOf(id)).find((r) => r.kind === "CUSTOM")!.remind_at.toISOString();
    expect(await at()).toBe(`${today(3)}T14:00:00.000Z`);

    // The due time changes: the reminder follows it.
    await page.getByRole("button", { name: /^Due/ }).click();
    await page.getByLabel("Due time (optional)").fill("16:00");
    await page.keyboard.press("Escape");
    await expect.poll(at).toBe(`${today(3)}T15:30:00.000Z`);
    await expect(chips.getByText("30 min before")).toBeVisible();

    // The chip can be removed again.
    await page.getByRole("button", { name: "Remove reminder: 30 min before" }).click();
    await expect(chips.getByText("30 min before")).toHaveCount(0);
    await page.getByRole("button", { name: /^Remind me/ }).click();
    await page.getByRole("button", { name: "5 minutes before", exact: true }).click();
    await expect(chips.getByText("5 min before")).toBeVisible();

    // Finishing the task cancels what was waiting.
    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Done" }).click();
    await expect
      .poll(async () => (await remindersOf(id)).filter((r) => r.status === "PENDING").length)
      .toBe(0);
    expect((await taskByTitle(user.id, "Dentist"))[0]!.status).toBe("DONE");
  });

  test("a task with only a date offers the day before, not a time reminder", async ({ page }) => {
    const user = await newUser(page);
    const id = await insertTask(user.id, { title: "Taxes", dueDate: today(5) });
    await page.goto(`/tasks/${id}`);
    await page.getByRole("button", { name: /^Remind me/ }).click();
    await expect(page.getByRole("button", { name: "15 minutes before" })).toBeDisabled();
    await expect(page.getByText("Add a time to the task to be reminded before it.")).toBeVisible();
    await page.getByRole("button", { name: "The evening before (18:00)" }).click();
    await expect(page.getByText("The evening before")).toBeVisible();
    await expect
      .poll(async () => (await remindersOf(id))[0])
      .toMatchObject({ kind: "CUSTOM", status: "PENDING" });
  });
});

test.describe("reminders inside the app", () => {
  test("a due reminder shows on Today with Snooze and Open, and still shows offline", async ({
    page,
    context,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertTask(user.id, {
      title: "Call the bank",
      dueDate: today(),
      dueTime: "09:00",
    });
    await insertReminder(user.id, id, { remindAt: new Date(Date.now() - 60_000), status: "SENT" });
    await page.goto("/today");

    const banner = page.getByRole("region", { name: "Reminders" });
    await expect(banner.getByText("Call the bank")).toBeVisible();
    await expect(page.getByTestId("nav-reminders")).toContainText("1");

    // What was loaded stays on screen when the connection drops.
    await context.setOffline(true);
    await expect(banner.getByText("Call the bank")).toBeVisible();
    await context.setOffline(false);

    await banner.getByRole("button", { name: "Snooze Call the bank" }).click();
    await page.getByRole("menuitem", { name: "1 hour" }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("nav-reminders")).toHaveCount(0);
    await expect.poll(async () => (await remindersOf(id))[0]!.status).toBe("SNOOZED");
  });

  test("Open goes to the task on Today and clears the reminder", async ({ page }) => {
    const user = await newUser(page);
    const id = await insertTask(user.id, {
      title: "Send the invoice",
      dueDate: today(),
      dueTime: "10:00",
    });
    await insertReminder(user.id, id, { remindAt: new Date(Date.now() - 60_000), status: "SENT" });
    await page.goto("/today");
    const banner = page.getByRole("region", { name: "Reminders" });
    await banner.getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(new RegExp(`/today\\?task=${id}`));
    await expect(
      page.getByRole("complementary", { name: "Task detail" }).getByLabel("Task title"),
    ).toHaveValue("Send the invoice");
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Reminders" })).toHaveCount(0);
  });

  test("a reminder that comes due while Today is open appears at its time, and can be dismissed", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertTask(user.id, { title: "Stand up", dueDate: today(), dueTime: "23:00" });
    await insertReminder(user.id, id, {
      remindAt: new Date(Date.now() + 4_000),
      status: "PENDING",
    });
    await page.goto("/today");
    const banner = page.getByRole("region", { name: "Reminders" });
    await expect(banner).toHaveCount(0);
    await expect(banner.getByText("Stand up")).toBeVisible({ timeout: 15_000 });
    await banner.getByRole("button", { name: "Dismiss reminder: Stand up" }).click();
    await expect(banner).toHaveCount(0);
  });

  test("has no serious accessibility problems at 360px, light and dark", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertTask(user.id, {
      title: "Call the bank",
      dueDate: today(),
      dueTime: "09:00",
    });
    await insertReminder(user.id, id, { remindAt: new Date(Date.now() - 60_000), status: "SENT" });
    await page.setViewportSize({ width: 360, height: 800 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/today");
      await expect(page.getByRole("region", { name: "Reminders" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${scheme}: no sideways scroll`,
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${scheme}: ${v.id}`),
        JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
      ).toEqual([]);
    }
    expect(taskRow).toBeDefined();
  });
});

test.describe("delivery", () => {
  async function dueTask(userId: string, title: string) {
    const id = await insertTask(userId, { title, dueDate: today(), dueTime: "23:30" });
    await insertReminder(userId, id, {
      remindAt: new Date(Date.now() - 30_000),
      kind: "DEFAULT_LEAD",
      spec: { type: "before", minutes: 15 },
    });
    return id;
  }

  test("a due reminder is pushed to the device once, with a link to the task", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const endpoint = `https://push.example.test/e2e/${crypto.randomUUID()}`;
    await insertPushSubscription(user.id, endpoint);
    const id = await dueTask(user.id, "Dentist");
    await runJobs(page);
    await expect.poll(async () => (await pushesTo(endpoint)).length).toBe(1);
    expect((await pushesTo(endpoint))[0]!.payload).toMatchObject({
      category: "TASK_REMINDER",
      title: "Dentist",
      url: `/tasks?task=${id}`,
    });
    // More ticks send nothing more.
    await runJobs(page);
    expect(await pushesTo(endpoint)).toHaveLength(1);
    expect((await notificationLogOf(user.id)).map((l) => l.status)).toEqual(["SENT"]);
  });

  test("quiet hours hold it, and a switched-off category sends nothing", async ({ page }) => {
    test.slow();
    const user = await newUser(page);
    const endpoint = `https://push.example.test/e2e/${crypto.randomUUID()}`;
    await insertPushSubscription(user.id, endpoint);

    // Quiet hours around now (in UTC, the person's zone).
    const hour = new Date().getUTCHours();
    const pad = (n: number) => String((n + 24) % 24).padStart(2, "0");
    await setQuietHoursDb(user.id, `${pad(hour - 1)}:00:00`, `${pad(hour + 2)}:00:00`);
    const held = await dueTask(user.id, "Held one");
    await runJobs(page);
    expect(await pushesTo(endpoint)).toHaveLength(0);
    await expect.poll(async () => (await remindersOf(held))[0]!.status).toBe("SNOOZED");
    expect((await notificationLogOf(user.id)).map((l) => l.status)).toContain("SUPPRESSED_QUIET");

    // Without quiet hours, but with the category off: nothing is sent either.
    await setQuietHoursDb(user.id, null, null);
    await setCategoryDb(user.id, "TASK_REMINDER", false);
    await ageSubscriptions(user.id);
    await dueTask(user.id, "Switched off");
    await runJobs(page);
    expect(await pushesTo(endpoint)).toHaveLength(0);
    expect((await notificationLogOf(user.id)).map((l) => l.status)).toContain("SUPPRESSED_PREF");

    // And with it back on, the next reminder arrives.
    await setCategoryDb(user.id, "TASK_REMINDER", true);
    await dueTask(user.id, "Allowed");
    await runJobs(page);
    await expect.poll(async () => (await pushesTo(endpoint)).length).toBe(1);
    expect((await pushesTo(endpoint))[0]!.payload.title).toBe("Allowed");
  });
});

test.describe("the service worker", () => {
  /** Delivers a push message to the page's worker, the way a push service would, through the browser's debugger. */
  async function deliverPush(page: Page, data: string) {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    const cdp = await page.context().newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => {
        const found = event.registrations.find((r: { scopeURL: string }) =>
          r.scopeURL.endsWith("/"),
        );
        if (found) resolve(found.registrationId);
      });
    });
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: new URL(page.url()).origin,
      registrationId: await registrationId,
      data,
    });
  }
  const shown = (page: Page) =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        data: n.data as { url: string; token: string | null },
        actions: ((n as Notification & { actions?: { action: string }[] }).actions ?? []).map(
          (a) => a.action,
        ),
      }));
    });

  test("shows a reminder with Open and Snooze, and still shows something for a payload it cannot read", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    await page.context().grantPermissions(["notifications"]);
    await page.goto("/today");

    await deliverPush(
      page,
      JSON.stringify({
        category: "TASK_REMINDER",
        title: "Dentist",
        body: "Due at 14:30",
        url: "/tasks?task=abc",
        tag: "reminder-1",
        reminderId: "r1",
        token: "v1.token",
      }),
    );
    await expect.poll(async () => (await shown(page)).length).toBe(1);
    expect((await shown(page))[0]).toMatchObject({
      title: "Dentist",
      body: "Due at 14:30",
      tag: "reminder-1",
      data: { url: "/tasks?task=abc", token: "v1.token" },
    });

    // Not JSON at all: still a notification, never a silent failure.
    await deliverPush(page, "this is not json");
    await expect.poll(async () => (await shown(page)).length).toBe(2);
    expect((await shown(page)).find((n) => n.tag === "dayboard")).toMatchObject({
      title: "Dayboard",
      data: { url: "/today" },
    });

    // An address on another site is never followed.
    await deliverPush(
      page,
      JSON.stringify({ title: "Odd", url: "https://evil.example/x", tag: "odd" }),
    );
    await expect.poll(async () => (await shown(page)).length).toBe(3);
    expect((await shown(page)).find((n) => n.tag === "odd")!.data.url).toBe("/today");
  });
});
