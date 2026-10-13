import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signOut, signUp, uniqueEmail } from "./helpers";

// V2 feature 03 §7 against the production build, where the worker is registered (`next dev` never
// registers it). The worker only shows the offline shell here: no data is read or written offline.

/** The first load installs the worker; the first page it controls is the reload after that. */
async function controlledPage(page: Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active);
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
}

test.describe("offline shell (feature 03)", () => {
  test("the worker is served with no-cache and may control the whole app", async ({ page }) => {
    await page.goto("/sign-in");
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active);
    });

    const response = await page.request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-cache");
    expect(response.headers()["service-worker-allowed"]).toBe("/");
  });

  test("after one online load, the app opens offline on the shell and shows no account data", async ({
    page,
  }) => {
    const name = "Offline Shell Person";
    await signUp(page, { name, email: uniqueEmail("shell") });
    await controlledPage(page);

    await page.context().setOffline(true);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);

    await page.context().setOffline(false);
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);
  });

  test("authenticated pages and the API are never stored; the shell is", async ({ page }) => {
    await signUp(page, { email: uniqueEmail("cache") });
    await controlledPage(page);
    await page.goto("/notes");
    await page.goto("/api/health");
    await page.goto("/today");

    const paths = await cachedPaths(page);
    expect(paths).toContain("/offline");
    expect(paths.filter((p) => /^\/(api|today|tasks|notes|settings)(\/|$)/.test(p))).toEqual([]);
  });

  test("sign-out removes the worker's caches", async ({ page }) => {
    await signUp(page, { email: uniqueEmail("signout") });
    await controlledPage(page);
    // A cache the worker did not make is left alone; a cache it did make must go.
    await page.evaluate(async () => {
      await (
        await caches.open("dayboard-static-planted")
      ).put("/tasks/secret", new Response("private"));
    });

    await signOut(page);
    const names = await page.evaluate(() => caches.keys());
    expect(names).not.toContain("dayboard-static-planted");
  });

  test("the shell comes back on the next online visit after sign-out", async ({ page }) => {
    await signUp(page, { email: uniqueEmail("back") });
    await controlledPage(page);
    await signOut(page);

    // Visiting a page online puts the shell back (it holds no account data).
    await page.goto("/sign-in");
    await expect
      .poll(async () => (await cachedPaths(page)).includes("/offline"), { timeout: 10_000 })
      .toBe(true);
  });
});
