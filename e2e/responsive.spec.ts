import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertInboxItem, insertNote, insertProject, insertTask, insertTodo } from "./db";
import { newDevice, signUp, today } from "./helpers";

// Feature 07 §11.4: the responsive matrix. At every width: no sideways scroll; at phone widths the
// bottom nav never covers the end of the page and controls are at least 44px tall.

const WIDTHS = [360, 390, 768, 1024, 1440, 1920];
const SIGNED_IN = [
  "/today",
  "/tasks",
  "/tasks?view=todos",
  "/projects",
  "/notes",
  "/notes?view=grid",
  "/inbox",
  "/search?q=invoice",
  "/trash",
  "/settings/appearance",
];
const PUBLIC = ["/", "/sign-in", "/sign-up", "/privacy"];

async function noSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.getElementById("main-panel");
    return {
      page: doc.scrollWidth - doc.clientWidth,
      panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
    };
  });
  expect(overflow.page, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(overflow.panel, `${label}: the main panel scrolls sideways`).toBeLessThanOrEqual(0);
}

async function phoneChecks(page: Page, label: string) {
  // The bottom nav never covers the last thing on the page.
  const covered = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"].fixed');
    const main = document.getElementById("main");
    if (!nav || !main) return 0;
    const items = [...main.querySelectorAll<HTMLElement>("button, a, input, li, p, h2")].filter(
      (el) => el.offsetParent !== null,
    );
    const last = items.at(-1);
    if (!last) return 0;
    return last.getBoundingClientRect().bottom - nav.getBoundingClientRect().top;
  });
  expect(covered, `${label}: the bottom nav covers content`).toBeLessThanOrEqual(0);

  // Tap targets: controls (not inline text links inside sentences) are at least 44px tall.
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'main button, main [role="checkbox"], main [role="tab"], main [role="switch"], main select, main input:not([type="hidden"])',
      ),
    ]
      .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden")
      .filter((el) => !el.closest(".ProseMirror, [data-tap-exempt]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height < 43.5)
      .map(
        ({ el, r }) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(r.height)}px`,
      ),
  );
  expect(small, `${label}: tap targets under 44px`).toEqual([]);
}

test.describe("responsive matrix", () => {
  test("signed-in screens fit every width", async ({ page }) => {
    test.setTimeout(240_000);
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    const project = await insertProject(user.id, {
      name: "A project with a fairly long name for a phone",
      color: "blue",
    });
    await insertTask(user.id, {
      title: "A very long task title that should truncate gracefully on a phone screen",
      dueDate: today(-20),
      priority: "HIGH",
    });
    await insertTask(user.id, { title: "Invoice the studio", dueDate: today() });
    await insertTodo(user.id, { title: "Buy oat milk", dueDate: today(-1) });
    await insertNote(user.id, {
      title: "Invoice notes",
      text: "The invoice is due soon.",
      projectId: project,
    });
    await insertInboxItem(user.id, "Look into standing desks under 30k and compare three of them");

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      for (const path of SIGNED_IN) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const label = `${path} at ${width}px`;
        await noSidewaysScroll(page, label);
        if (width < 768) await phoneChecks(page, label);
      }
    }
  });

  test("public screens fit every width", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await newDevice(browser);
    const page = await context.newPage();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PUBLIC) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await noSidewaysScroll(page, `${path} at ${width}px`);
      }
    }
    await context.close();
  });
});
