import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { newDevice, signUp } from "./helpers";

// Feature 07 §11.1: a small set of visual baselines (42 images), reviewed by eye when they change.
// Never update them blindly: `pnpm test:e2e e2e/visual.spec.ts --update-snapshots` only after
// looking at the diff. The server's clock decides "today" and the greeting, which a test can't
// pin, so the set is screens whose content doesn't depend on the time, and Today masks its
// greeting and date. Baselines are per platform (macOS here); CI needs its own Linux set.

const WIDTHS = [360, 768, 1440];
const THEMES = ["light", "dark"] as const;

const shot = (page: Page, name: string, mask: string[] = []) =>
  expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
    mask: mask.map((selector) => page.locator(selector)),
  });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`${theme} ${width}px`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: 900 }, reducedMotion: "reduce" });

      test(`public pages (${theme}, ${width})`, async ({ browser }) => {
        const context = await newDevice(browser, {
          colorScheme: theme,
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await shot(page, `landing-${theme}-${width}`);
        await page.goto("/sign-in");
        await page.waitForLoadState("networkidle");
        await shot(page, `sign-in-${theme}-${width}`);
        await context.close();
      });

      test(`empty states (${theme}, ${width})`, async ({ page }) => {
        test.slow();
        await signUp(page);
        for (const [path, name] of [
          ["/tasks", "tasks-empty"],
          ["/notes", "notes-empty"],
          ["/projects", "projects-empty"],
          ["/inbox", "inbox-zero"],
          ["/trash", "trash-empty"],
        ] as const) {
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          await shot(page, `${name}-${theme}-${width}`);
        }
        await page.goto("/today");
        await page.waitForLoadState("networkidle");
        // The greeting and the date come from the server's clock.
        await shot(page, `today-empty-${theme}-${width}`, ["main h1", "main h1 + p"]);
      });
    });
  }
}
