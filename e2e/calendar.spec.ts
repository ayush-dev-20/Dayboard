import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { calendarCounts, findUser, preferencesFor, setCalendarStatus, setDayPrefs } from "./db";
import { signUp } from "./helpers";

// V2 feature 12 against the mock calendar: the real connect and callback routes run, with the mock standing in for
// Google's consent screen. The person is set to UTC with a midnight rollover, so the mock's fixed-time events fall on
// the person's "today".

test.use({ viewport: { width: 1280, height: 900 } });

const utcToday = () => new Date().toISOString().slice(0, 10);

async function newUser(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  await setDayPrefs(user.id, "UTC", "00:00:00");
  return user;
}

async function connect(page: Page) {
  await page.goto("/settings/calendar");
  await page.getByRole("link", { name: "Connect Google Calendar" }).click();
  await expect(page.getByText("Google Calendar is connected.")).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
}

const todayEvents = (page: Page) => page.getByRole("region", { name: /^Today's events/ });

test.describe("Google Calendar settings", () => {
  test("shows a plain explanation, connects, and lists the account and its calendars", async ({
    page,
  }) => {
    const user = await newUser(page);
    await page.goto("/settings/calendar");
    await expect(
      page.getByText(/won't change them unless you create an event from a task/),
    ).toBeVisible();
    await expect(page.getByText("This server uses a test calendar")).toBeVisible();

    await page.getByRole("link", { name: "Connect Google Calendar" }).click();
    await expect(page.getByText("Google Calendar is connected.")).toBeVisible();
    await expect(page.getByText("mock.person@example.com")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Personal" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Work" })).not.toBeChecked();
    const counts = await calendarCounts(user.id);
    expect(counts).toMatchObject({ accounts: 1, sources: 2 });
  });

  test("a calendar can be turned on and off, and off removes what it showed", async ({ page }) => {
    const user = await newUser(page);
    await connect(page);
    const before = (await calendarCounts(user.id)).events;
    expect(before).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: "Work" }).check();
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect.poll(async () => (await calendarCounts(user.id)).events).toBeGreaterThan(before);

    await page.getByRole("checkbox", { name: "Personal" }).uncheck();
    await page.getByRole("checkbox", { name: "Work" }).uncheck();
    await expect.poll(async () => (await calendarCounts(user.id)).events).toBe(0);
  });

  test("disconnecting asks first, then removes the account and everything saved", async ({
    page,
  }) => {
    const user = await newUser(page);
    await connect(page);
    await page.getByRole("button", { name: "Disconnect" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("removes the events it saved, right away");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await calendarCounts(user.id)).accounts).toBe(1);

    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
    expect(await calendarCounts(user.id)).toEqual({ accounts: 0, sources: 0, events: 0 });
  });

  test("when Google needs the person again, Settings and Today say so, and the last events stay", async ({
    page,
  }) => {
    const user = await newUser(page);
    await connect(page);
    await setCalendarStatus(user.id, "NEEDS_RECONNECT");

    await page.goto("/settings/calendar");
    // Next also renders an empty route announcer with this role: pick ours by its text.
    const banner = page.getByRole("alert").filter({ hasText: "Google needs you to connect again" });
    await expect(banner).toBeVisible();
    await expect(page.getByRole("link", { name: "Reconnect Google Calendar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);

    await page.goto("/today");
    await expect(todayEvents(page)).toContainText("Design review");
    await expect(todayEvents(page)).toContainText("Google Calendar needs reconnecting");

    // One click and it is back.
    await page.goto("/settings/calendar");
    await page.getByRole("link", { name: "Reconnect Google Calendar" }).click();
    await expect(page.getByText("Google Calendar is connected.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "connect again" })).toHaveCount(0);
  });

  test("working hours live in Productivity, and work has to end after it starts", async ({
    page,
  }) => {
    const user = await newUser(page);
    await page.goto("/settings/productivity");
    await expect(page.getByLabel("Work starts")).toHaveValue("09:00");
    await expect(page.getByLabel("Work ends")).toHaveValue("18:00");

    await page.getByLabel("Work ends").selectOption("17:30");
    await expect(page.getByText("Saved").first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Work ends")).toHaveValue("17:30");

    // Ending before the start is refused, and the control goes back.
    await page.getByLabel("Work ends").selectOption("08:00");
    await expect(page.getByText("Work should end after it starts.")).toBeVisible();
    await expect(page.getByLabel("Work ends")).toHaveValue("17:30");
    expect((await preferencesFor(user.id))?.timezone).toBe("UTC");
  });
});

test.describe("events in Today and the Calendar view", () => {
  test("Today lists the day's events above the tasks, with times, all-day and maybe", async ({
    page,
  }) => {
    await newUser(page);
    await connect(page);
    await page.goto("/today");

    const events = todayEvents(page);
    await expect(events).toBeVisible();
    const design = events.getByRole("link", {
      name: /Design review, Personal, opens in Google Calendar/,
    });
    await expect(design).toHaveAttribute("target", "_blank");
    await expect(design).toHaveAttribute("rel", /noopener/);
    await expect(events).toContainText("10:00–11:00");
    await expect(events).toContainText("Maybe: coffee with Sam");
    await expect(events.getByText("Maybe", { exact: true })).toBeVisible();
    // Tomorrow's all-day event is not today's.
    await expect(events).not.toContainText("Team offsite");
    // The Work calendar is not selected.
    await expect(events).not.toContainText("Roadmap sync");
  });

  test("Today is unchanged with no calendar connected", async ({ page }) => {
    await newUser(page);
    await page.goto("/today");
    await expect(todayEvents(page)).toHaveCount(0);
    await expect(page.getByText("Google Calendar", { exact: false })).toHaveCount(0);
  });

  test("the Calendar view draws the events as quiet, read-only blocks next to tasks", async ({
    page,
  }) => {
    await newUser(page);
    await connect(page);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Calendar", exact: true }).last().click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("grid")).toBeVisible();

    const event = page.getByTestId("overlay-event").filter({ hasText: "Design review" }).first();
    await expect(event).toBeVisible();
    await expect(event).toHaveAttribute("aria-label", "Design review, Personal");
    // Not a task: it has no item id to drag, and no drag handle.
    await expect(event).not.toHaveAttribute("data-item-id", /.+/);
    await expect(
      page.getByTestId("overlay-event").filter({ hasText: "Maybe: coffee" }).first(),
    ).toHaveAttribute("aria-label", /maybe/);
  });
});

test.describe("accessibility and small screens", () => {
  test("Settings → Calendar and Today with events have no serious axe violations, in light and dark", async ({
    page,
  }) => {
    await newUser(page);
    await connect(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ["/settings/calendar", "/today"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const serious = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          serious.map((v) => `${path} ${scheme}: ${v.id}`),
          JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
        ).toEqual([]);
      }
    }
  });

  test("at 360px the events fit the screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await newUser(page);
    await connect(page);
    await page.goto("/today");
    await expect(todayEvents(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.goto("/settings/calendar");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});

test("the calendar is for the signed-in person only: a signed-out request gets nothing", async ({
  request,
}) => {
  const events = await request.get(`/api/calendar/events?from=${utcToday()}&to=${utcToday()}`);
  expect(events.status()).toBe(401);
  const status = await request.get("/api/calendar/status");
  expect(status.status()).toBe(401);
});
