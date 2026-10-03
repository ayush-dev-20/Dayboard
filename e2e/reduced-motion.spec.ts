import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertTask } from "./db";
import { signUp } from "./helpers";

// Feature 07 §11.3. With reduced motion, nothing moves: we sample the target's computed transform
// (and the separate `scale` and `translate` properties, which CSS animations also use) on every
// frame for ~320ms after it appears, and every sample must equal the settled value. The same check
// with motion allowed must see movement, which proves the test isn't vacuous.

type Sampler = { selector: string; text?: string };

async function startSampling(page: Page, target: Sampler) {
  await page.evaluate(({ selector, text }) => {
    const w = window as unknown as { __samples: string[] };
    w.__samples = [];
    const start = performance.now();
    const tick = () => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (e) => !text || e.textContent?.includes(text),
      );
      if (el) {
        const cs = getComputedStyle(el);
        // An identity matrix is no movement at all (fade keyframes set one explicitly).
        const identity =
          /^matrix\(1, 0, 0, 1, 0, 0\)$|^matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\)$/;
        const transform = identity.test(cs.transform) ? "none" : cs.transform;
        w.__samples.push(`${transform} | ${cs.scale} | ${cs.translate}`);
      }
      if (w.__samples.length < 20 && performance.now() - start < 3000) requestAnimationFrame(tick);
    };
    // Also sample the moment the element is inserted, before the first frame, so a starting
    // offset is seen even when a busy machine delivers the first frame late.
    const observer = new MutationObserver(() => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (e) => !text || e.textContent?.includes(text),
      );
      if (!el || w.__samples.length > 0) return;
      tick();
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 3000);
    requestAnimationFrame(tick);
  }, target);
}

async function samples(page: Page): Promise<string[]> {
  await page.waitForTimeout(450);
  return page.evaluate(() => (window as unknown as { __samples: string[] }).__samples);
}

function settled(list: string[]) {
  expect(list.length, "the element appeared and was sampled").toBeGreaterThan(5);
  return new Set(list).size === 1;
}

async function scenarios(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  await insertTask(user.id, { title: "Existing task" });
  await insertTask(user.id, { title: "Open me" });
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Existing task", exact: true })).toBeVisible();
  const results: Record<string, string[]> = {};

  // List add: a new row arrives.
  await startSampling(page, { selector: "li[data-task-id]", text: "Freshly added" });
  await page.getByLabel("Add task", { exact: true }).fill("Freshly added");
  await page.keyboard.press("Enter");
  results["list add"] = await samples(page);

  // Task sheet opens.
  await startSampling(page, { selector: 'aside[aria-label="Task detail"]' });
  await page.getByRole("button", { name: "Open me", exact: true }).click();
  results["sheet open"] = await samples(page);
  await page.getByRole("button", { name: "Close task" }).click();
  // Closing the panel widens the list, and rows glide to their new place; let that settle so the
  // next check measures only what completing does.
  await expect(page.getByRole("complementary", { name: "Task detail" })).toHaveCount(0);
  await page.waitForTimeout(700);

  // Task complete: the row must not move while Undo is offered.
  await startSampling(page, { selector: "li[data-task-id]", text: "Existing task" });
  await page.getByRole("checkbox", { name: "Complete Existing task" }).click();
  results["task complete"] = await samples(page);

  // Dialog opens.
  await page.goto("/projects");
  await startSampling(page, { selector: '[role="dialog"]' });
  await page.getByRole("button", { name: "New project" }).first().click();
  results["dialog open"] = await samples(page);
  await page.keyboard.press("Escape");

  // Route change: opacity only, in both modes.
  await startSampling(page, { selector: "[data-route-fade]" });
  await page
    .getByRole("complementary")
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Notes" })
    .click();
  await expect(page).toHaveURL(/\/notes/);
  results["route change"] = await samples(page);

  // Shimmer and the streaming caret: are their animations running?
  const running = await page.evaluate(() => {
    const probe = (className: string) => {
      const el = document.createElement("span");
      el.className = className;
      document.body.append(el);
      const name = getComputedStyle(el).animationName;
      el.remove();
      return name;
    };
    return {
      shimmer: probe("skeleton"),
      caret: probe("motion-safe:animate-[caret-blink_1s_steps(2,start)_infinite]"),
    };
  });
  return { results, running };
}

test.use({ viewport: { width: 1280, height: 800 } });

test("with reduced motion, nothing moves; fades and color changes are allowed", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { results, running } = await scenarios(page);
  for (const [name, list] of Object.entries(results)) {
    expect(settled(list), `${name} moved:\n${[...new Set(list)].join("\n")}`).toBe(true);
  }
  expect(running.shimmer).toBe("none");
  expect(running.caret).toBe("none");
});

test("with motion allowed, the same check sees movement (so it isn't vacuous)", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { results, running } = await scenarios(page);
  for (const name of ["list add", "sheet open", "dialog open"]) {
    expect(settled(results[name]!), `${name} should animate`).toBe(false);
  }
  // These never move, even with motion allowed: the route fade is opacity only, and a completed
  // row stays put while Undo is offered.
  expect(settled(results["route change"]!)).toBe(true);
  expect(
    settled(results["task complete"]!),
    `task complete moved:\n${[...new Set(results["task complete"])].join("\n")}`,
  ).toBe(true);
  expect(running.shimmer).toBe("shimmer");
  expect(running.caret).toBe("caret-blink");
});
