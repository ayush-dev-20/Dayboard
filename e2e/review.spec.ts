import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertPostponements,
  insertReview,
  insertTask,
  restoreHistoryEpoch,
  reviewPrefsOf,
  reviewsOf,
  scheduleHistoryOf,
  setFinal,
  setAiEnabled,
  setHistoryEpoch,
  taskDueAndStatus,
  weeklyReviewAuditOf,
} from "./db";
import { signUp, today, uniqueEmail } from "./helpers";
import { addDays } from "../src/lib/dates/calendar";
import { endOfWeek, startOfWeek } from "../src/lib/views/due-buckets";

// V2 feature 15 (acceptance), against the mock provider. Every test person gets a week with things in it
// (done tasks, late tasks), the way a real week would look, and the review is made through the real route. The
// mock's suggestions are predictable: the oldest late task is rescheduled to tomorrow, the second is kept and the
// third is dropped. The "week" is the person's own (Monday first, India time, like every test person).

test.use({ viewport: { width: 1280, height: 900 } });

const weekStart = () => startOfWeek(today(), 1);
const weekEnd = () => endOfWeek(today(), 1);

async function personWithAWeek(page: Page) {
  const account = await signUp(page, { email: uniqueEmail("review") });
  const user = (await findUser(account.email))!;
  await insertTask(user.id, { title: "Shipped the report", status: "DONE" });
  await insertTask(user.id, { title: "Sent the invoice", status: "DONE" });
  await insertTask(user.id, { title: "Sorted the files", status: "DONE" });
  const old = await insertTask(user.id, { title: "Old report", dueDate: today(-9) });
  const mid = await insertTask(user.id, { title: "Mid task", dueDate: today(-3) });
  const third = await insertTask(user.id, { title: "Third task", dueDate: today(-2) });
  return { userId: user.id, old, mid, third };
}

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function generate(page: Page) {
  await page.goto("/review");
  await page.getByRole("button", { name: "Generate now" }).first().click();
  await expect(heading(page, "What happened")).toBeVisible({ timeout: 20_000 });
}

test.describe("the page and generating", () => {
  test("is in the sidebar, needs a sign-in, and says so when there is nothing to review yet", async ({
    page,
    browser,
  }) => {
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto("/review");
    await expect(visitor).toHaveURL(/\/sign-in/);
    await anonymous.close();

    const account = await signUp(page, { email: uniqueEmail("review-empty") });
    await page.getByRole("complementary").getByRole("link", { name: "Weekly review" }).click();
    await expect(page).toHaveURL(/\/review/);
    await expect(page.getByText("Nothing to review yet this week.")).toBeVisible();
    await page.getByRole("button", { name: "Generate now" }).last().click();
    await expect(page.getByText(/Nothing was done or written yet/)).toBeVisible();
    // A quiet week is a valid week: no review was made for it.
    expect(await reviewsOf((await findUser(account.email))!.id)).toEqual([]);
  });

  test("Generate now shows what happened, counted from the data, apart from the labelled AI suggestions", async ({
    page,
  }) => {
    const { userId } = await personWithAWeek(page);
    await generate(page);

    // Facts: plain headings and lists, from the stored data.
    await expect(page.getByText("3 tasks and 0 todos completed.")).toBeVisible();
    await expect(
      page.getByText(/3 open tasks are overdue or due this week, oldest 9 days late/),
    ).toBeVisible();
    await expect(page.getByText("This is the week so far.")).toBeVisible();
    const facts = page.getByRole("region", { name: "What happened" });
    await expect(facts.getByText("AI-generated")).toHaveCount(0);

    // Suggestions: in the labelled AI panel, and nowhere else.
    const panel = page.getByRole("region", { name: "Suggested focus" });
    await expect(panel.getByText("AI-generated")).toBeVisible();
    await expect(panel.getByText(/You finished 3 things this week/)).toBeVisible();

    const [row] = await reviewsOf(userId);
    expect(row).toMatchObject({
      week_start: weekStart(),
      partial: true,
      suggestions_status: "GENERATED",
    });
  });

  test("a Based on chip takes you to the fact it rests on and marks it", async ({ page }) => {
    await personWithAWeek(page);
    await generate(page);
    const panel = page.getByRole("region", { name: "Suggested focus" });
    await panel.getByRole("button", { name: /Overdue and carry-forward/ }).click();
    // The list was closed: it opens, and the first item it rests on is marked and focused.
    const target = page.locator('[id^="fact-item-overdue-"]').first();
    await expect(target).toBeVisible();
    await expect(target).toHaveClass(/outline-primary/);
    await expect(target).toBeFocused();
    // The mark goes away by itself.
    await expect(target).not.toHaveClass(/outline-primary/, { timeout: 5000 });
  });

  test("a second Generate now refreshes the week so far and does not make another review", async ({
    page,
  }) => {
    const { userId } = await personWithAWeek(page);
    await generate(page);
    await insertTask(userId, { title: "Another done", status: "DONE" });
    await page.getByRole("button", { name: "Generate now" }).click();
    await expect(page.getByText("4 tasks and 0 todos completed.")).toBeVisible({ timeout: 20_000 });
    expect(await reviewsOf(userId)).toHaveLength(1);
  });
});

test.describe("the carry-forward proposal", () => {
  test("nothing changes until Apply, then exactly the ticked rows do, and Undo puts them back", async ({
    page,
  }) => {
    const { userId, old, mid, third } = await personWithAWeek(page);
    await generate(page);

    const carry = page.getByRole("region", { name: "Carry-forward" });
    // Suggested: reschedule the oldest, keep the second, drop the third (which starts unticked).
    await expect(carry.getByRole("checkbox", { name: "Include Old report" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(carry.getByRole("checkbox", { name: "Include Mid task" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(carry.getByRole("checkbox", { name: "Include Third task" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(carry.getByRole("button", { name: "Apply 1", exact: true })).toBeVisible();
    // Nothing has been touched yet.
    expect((await taskDueAndStatus(old))!.due_date).toBe(today(-9));

    // Change the date of the first, and tick the third (an archive).
    await carry.getByRole("button", { name: /New date for Old report/ }).click();
    await page.getByLabel("New date for Old report", { exact: true }).fill(today(5));
    await page.keyboard.press("Escape");
    await carry.getByRole("checkbox", { name: "Include Third task" }).click();
    await expect(carry.getByRole("button", { name: "Apply 2", exact: true })).toBeVisible();
    await carry.getByRole("button", { name: "Apply 2", exact: true }).click();

    await expect(page.getByText("Applied 2 changes.").first()).toBeVisible();
    expect(await taskDueAndStatus(old)).toMatchObject({ due_date: today(5), archived: false });
    expect(await taskDueAndStatus(mid)).toMatchObject({ due_date: today(-3), status: "PLANNED" });
    expect(await taskDueAndStatus(third)).toMatchObject({ archived: true });
    // The move is in the schedule history, with its reason, and one audit row holds counts only.
    expect(await scheduleHistoryOf(old)).toEqual([
      { from_date: today(-9), to_date: today(5), reason: "REVIEW" },
    ]);
    const audit = await weeklyReviewAuditOf(userId);
    expect(audit).toEqual([
      { summary: "Weekly review: rescheduled 1 task, archived 1 task", source: "WEEKLY_REVIEW" },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/Old report|Third/);

    // Undo (the toast's button).
    await page
      .getByRole("region", { name: /Notifications/ })
      .getByRole("button", { name: "Undo" })
      .first()
      .dispatchEvent("click");
    await expect(page.getByText("Undone.")).toBeVisible();
    expect(await taskDueAndStatus(old)).toMatchObject({ due_date: today(-9), archived: false });
    expect(await taskDueAndStatus(third)).toMatchObject({ archived: false });
  });

  test("a reschedule row without a valid date cannot be applied", async ({ page }) => {
    await personWithAWeek(page);
    await generate(page);
    const carry = page.getByRole("region", { name: "Carry-forward" });
    await carry.getByRole("button", { name: /New date for Old report/ }).click();
    await page.getByLabel("New date for Old report", { exact: true }).fill(today(-1));
    await page.keyboard.press("Escape");
    await expect(carry.getByRole("button", { name: /^Apply/ })).toBeDisabled();
  });
});

test.describe("without AI, and when AI fails", () => {
  test("AI off gives facts only, and turning it on later adds suggestions", async ({ page }) => {
    const { userId } = await personWithAWeek(page);
    await setAiEnabled(userId, false);
    await generate(page);
    await expect(page.getByText("AI is off, so this review has facts only.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Suggested focus" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add suggestions" })).toHaveCount(0);
    expect((await reviewsOf(userId))[0]).toMatchObject({
      suggestions_status: "OFF",
      suggestions_error: "AI_OFF",
    });

    await setAiEnabled(userId, true);
    await page.reload();
    await page.getByRole("button", { name: "Add suggestions" }).click();
    await expect(page.getByRole("region", { name: "Suggested focus" })).toBeVisible({
      timeout: 20_000,
    });
    expect((await reviewsOf(userId))[0]!.suggestions_status).toBe("GENERATED");
  });

  test("a failing provider leaves the facts, says so plainly, and offers Add suggestions", async ({
    page,
  }) => {
    const { userId } = await personWithAWeek(page);
    await insertTask(userId, { title: "Broken [mock:error]", dueDate: today(-4) });
    await generate(page);
    await expect(heading(page, "What happened")).toBeVisible();
    await expect(page.getByText(/Suggestions aren't available right now/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add suggestions" })).toBeVisible();
    expect((await reviewsOf(userId))[0]).toMatchObject({
      status: "READY",
      suggestions_error: "AI_PROVIDER_ERROR",
    });
  });

  test("a failed request keeps the page and offers Retry", async ({ page }) => {
    await personWithAWeek(page);
    await page.goto("/review");
    await page.route("**/api/review/generate", (route) => route.abort());
    await page.getByRole("button", { name: "Generate now" }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: /offline/ })).toBeVisible();
    await page.unroute("**/api/review/generate");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(heading(page, "What happened")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("history and the Today card", () => {
  test("offers a finished, unread review once, until it is opened or dismissed", async ({
    page,
  }) => {
    const account = await signUp(page, { email: uniqueEmail("review-card") });
    const userId = (await findUser(account.email))!.id;
    const previous = addDays(weekStart(), -7);
    await insertReview(userId, {
      weekStart: previous,
      weekEnd: addDays(previous, 6),
      viewed: true,
    });
    await insertReview(userId, { weekStart: weekStart(), weekEnd: weekEnd() });

    await page.goto("/today");
    const card = page.getByRole("region", { name: "Weekly review" });
    await expect(card.getByText("Your weekly review is ready")).toBeVisible();
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByText("Your weekly review is ready")).toHaveCount(0);
    expect((await reviewsOf(userId))[0]!.dismissed_at).not.toBeNull();
  });

  test("Open goes to the review and marks it read, and a week so far gets no card", async ({
    page,
  }) => {
    const account = await signUp(page, { email: uniqueEmail("review-open") });
    const userId = (await findUser(account.email))!.id;
    await insertReview(userId, { weekStart: weekStart(), weekEnd: weekEnd(), partial: true });
    await page.goto("/today");
    await expect(page.getByText("Your weekly review is ready")).toHaveCount(0);

    // Make it a finished one: the card appears, Open goes to it, and it is never offered again.
    await setFinal(userId);
    await page.reload();
    await page
      .getByRole("region", { name: "Weekly review" })
      .getByRole("link", { name: "Open" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/review\\?week=${weekStart()}`));
    await expect(heading(page, "What happened")).toBeVisible();
    await expect.poll(async () => (await reviewsOf(userId))[0]!.viewed_at).not.toBeNull();
    await page.goto("/today");
    await expect(page.getByText("Your weekly review is ready")).toHaveCount(0);
  });

  test("the week switcher lists the weeks that have a review and opens each", async ({ page }) => {
    const account = await signUp(page, { email: uniqueEmail("review-history") });
    const userId = (await findUser(account.email))!.id;
    const previous = addDays(weekStart(), -7);
    await insertReview(userId, {
      weekStart: previous,
      weekEnd: addDays(previous, 6),
      viewed: true,
    });
    await insertReview(userId, { weekStart: weekStart(), weekEnd: weekEnd(), viewed: true });

    await page.goto("/review");
    const switcher = page.getByLabel("Choose a week");
    await expect(switcher.locator("option")).toHaveCount(2);
    await switcher.selectOption(previous);
    await expect(page).toHaveURL(new RegExp(`week=${previous}`));
    await expect(heading(page, "What happened")).toBeVisible();
    // A past week cannot be generated.
    await expect(page.getByRole("button", { name: "Generate now" })).toHaveCount(0);
  });
});

test.describe.serial("postponements", () => {
  test("lists tasks moved later more than once when there is enough history", async ({ page }) => {
    const { userId } = await personWithAWeek(page);
    const slips = await insertTask(userId, { title: "Keeps slipping", dueDate: today(-1) });
    await insertPostponements(userId, slips);
    const old = await setHistoryEpoch(30);
    try {
      await generate(page);
      await expect(page.getByText(/moved later 2 times in four weeks/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Keeps slipping" }).first()).toBeVisible();
    } finally {
      await restoreHistoryEpoch(old);
    }
  });

  test("says there is not enough history yet when the log is young, and never guesses", async ({
    page,
  }) => {
    const { userId } = await personWithAWeek(page);
    const slips = await insertTask(userId, { title: "Slipped", dueDate: today(-1) });
    await insertPostponements(userId, slips);
    const old = await setHistoryEpoch(3);
    try {
      await generate(page);
      await expect(page.getByText(/Not enough history yet/)).toBeVisible();
      await expect(page.getByText(/moved later/)).toHaveCount(0);
    } finally {
      await restoreHistoryEpoch(old);
    }
  });
});

test.describe("settings", () => {
  test("the weekly review can be switched off and its day and time chosen", async ({ page }) => {
    const account = await signUp(page, { email: uniqueEmail("review-settings") });
    const userId = (await findUser(account.email))!.id;
    await page.goto("/settings/productivity");
    await expect(page.getByLabel("Make a weekly review")).toBeChecked();
    await page.getByLabel("Review day").selectOption("5");
    await page.getByLabel("Review time").selectOption("9");
    await expect
      .poll(async () => reviewPrefsOf(userId))
      .toMatchObject({ enabled: true, day: 5, hour: 9 });
    await page.getByLabel("Review day").selectOption("default");
    await expect.poll(async () => (await reviewPrefsOf(userId)).day).toBeNull();

    await page.getByLabel("Make a weekly review").click();
    await expect.poll(async () => (await reviewPrefsOf(userId)).enabled).toBe(false);
    await expect(page.getByLabel("Review day")).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Make a weekly review")).not.toBeChecked();
  });
});

test.describe("accessibility and layout", () => {
  test("the review has no serious accessibility problems, in light and dark", async ({ page }) => {
    await personWithAWeek(page);
    await generate(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const results = await new AxeBuilder({ page }).include("#main").analyze();
      expect(
        results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
      ).toEqual([]);
    }
  });

  test("fits a 360px phone: nothing wider than the screen, and the page is in More", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await personWithAWeek(page);
    await generate(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page
      .getByRole("region", { name: "Carry-forward" })
      .getByRole("button", { name: /^Apply/ })
      .scrollIntoViewIfNeeded();
    await page.goto("/more");
    await expect(page.getByRole("link", { name: "Weekly review" })).toBeVisible();
  });
});
