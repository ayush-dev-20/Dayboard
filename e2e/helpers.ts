import {
  expect,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { addDays, formatDay } from "../src/lib/dates/calendar";
import { getUserToday } from "../src/lib/dates/today";
import { waitForEmail } from "./mailbox";

export const PASSWORD = "correct-horse-battery";

let counter = 0;
export function uniqueEmail(label = "user") {
  counter += 1;
  return `${label}+${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}@example.com`;
}

export type Account = { email: string; password: string; name: string };

/** Fills the sign-up form, verifies the email through the captured link, and (by default) onboards. */
export async function signUp(
  page: Page,
  options: { name?: string; email?: string; password?: string; onboard?: boolean } = {},
): Promise<Account> {
  const account: Account = {
    name: options.name ?? "Test User",
    email: options.email ?? uniqueEmail(),
    password: options.password ?? PASSWORD,
  };

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const verification = await waitForEmail(account.email, "verify-email");
  await page.goto(verification.link);
  await expect(page).toHaveURL(/\/onboarding/);

  if (options.onboard !== false) await completeOnboarding(page);
  return account;
}

export async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: "Continue to Today" }).click();
  await expect(page).toHaveURL(/\/today/);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/**
 * The visible form or page alert. Next.js also renders an empty `role="alert"` route announcer on
 * every page, so a bare getByRole("alert") matches two elements.
 */
export function alertIn(scope: Page | Locator) {
  return scope.getByRole("alert").filter({ hasText: /\S/ });
}

let ipCounter = 0;
/** A private-range address no other test is using. */
export function fakeClientIp() {
  ipCounter += 1;
  const n = (Math.floor(Math.random() * 0xffffff) + ipCounter) & 0xffffff;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/** A new browser profile (a separate "device") with its own client address. */
export function newDevice(browser: Browser, options: BrowserContextOptions = {}) {
  return browser.newContext({
    ...options,
    extraHTTPHeaders: { ...options.extraHTTPHeaders, "x-forwarded-for": fakeClientIp() },
  });
}

/** The person's "today" (Asia/Kolkata, 06:00 rollover, the defaults every test user gets). */
export function today(offsetDays = 0): string {
  const base = getUserToday({ timezone: "Asia/Kolkata", startOfDay: "06:00" });
  return offsetDays === 0 ? base : addDays(base, offsetDays);
}

/** The chip text the app shows for a date, e.g. "Oct 2". */
export function chipFor(offsetDays: number): string {
  return formatDay(today(offsetDays), today());
}

/** The row for a task title on the Tasks list (the title button has the exact name). */
export function taskRow(page: Page, title: string) {
  return page
    .locator("[data-task-id]")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

export function todoRow(page: Page, title: string) {
  return page
    .locator("[data-todo-id]")
    .filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

export function detailPanel(page: Page) {
  return page.getByRole("complementary", { name: "Task detail" });
}

/** Adds a task through the inline add row and waits for it to appear. */
export async function addTask(page: Page, title: string) {
  await page.getByLabel("Add task", { exact: true }).fill(title);
  await page.keyboard.press("Enter");
  await expect(taskRow(page, title)).toBeVisible();
}

export async function openTask(page: Page, title: string) {
  await taskRow(page, title).getByRole("button", { name: title, exact: true }).click();
  await expect(detailPanel(page)).toBeVisible();
}

/**
 * The element's box once it has stopped moving. Rows glide when a list re-centers and panels spring
 * in (feature 07 motion), so measure positions only after they settle.
 */
export async function stillBox(locator: Locator) {
  let previous = await locator.boundingBox();
  for (let i = 0; i < 40; i += 1) {
    await locator.page().waitForTimeout(50);
    const next = await locator.boundingBox();
    if (previous && next && JSON.stringify(previous) === JSON.stringify(next)) return next;
    previous = next;
  }
  return previous;
}

/** Waits for an element's own CSS and Web Animations (an opening dialog's fade and scale) to end. */
export async function animationsDone(locator: Locator) {
  await locator.evaluate(async (el) => {
    // Two frames first, so an animation that starts on mount has begun and can be awaited.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)),
    );
  });
}
