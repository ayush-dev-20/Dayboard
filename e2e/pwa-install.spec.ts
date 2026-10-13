import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signUp, uniqueEmail } from "./helpers";

// V2 feature 03 §4 and §5 against the production build. Chromium never offers a real install in
// automation, so the install offer is simulated where a test needs it.

/** Chromium's install offer, as the browser would send it. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
}

/** PNG width and height, read from the IHDR chunk. */
function pngSize(body: Buffer) {
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

test.describe("install and manifest (feature 03)", () => {
  test("the manifest is linked and every icon is served as the size it claims", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();

    const manifest = await (await page.request.get(href!)).json();
    expect(manifest.start_url).toBe("/today?source=pwa");

    const expected: Record<string, number> = {
      "/icons/192": 192,
      "/icons/512": 512,
      "/icons/maskable": 512,
      "/icons/96": 96,
    };
    for (const [src, size] of Object.entries(expected)) {
      const response = await page.request.get(src);
      expect(response.status(), src).toBe(200);
      expect(response.headers()["content-type"], src).toBe("image/png");
      expect(pngSize(await response.body()), src).toEqual({ width: size, height: size });
    }
    expect(manifest.shortcuts).toHaveLength(4);
  });

  test("Settings → App says how this browser can install Dayboard", async ({ page }) => {
    await signUp(page, { email: uniqueEmail("app") });
    await page.goto("/settings/app");
    // Headless Chromium has no install offer, so it is told to use its own menu.
    await expect(page.getByRole("heading", { name: "App" })).toBeVisible();
    await expect(page.getByText("Your browser can install Dayboard from its menu.")).toBeVisible();

    await offerInstall(page);
    await expect(page.getByRole("button", { name: "Install Dayboard" })).toBeVisible();
  });

  test("the top bar says Offline while the connection is down, and nothing otherwise", async ({
    page,
    context,
  }) => {
    await signUp(page, { email: uniqueEmail("online") });
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
  });

  test("the install tip appears on the third app open, once, and a dismissal keeps it away", async ({
    page,
  }) => {
    await signUp(page, { email: uniqueEmail("tip") });

    // Count two earlier app opens, then open the app in a new session: that is the third.
    await page.evaluate(() => {
      localStorage.setItem("pwa:visitCount", "2");
      sessionStorage.removeItem("pwa:visitCounted");
    });
    await page.goto("/today");
    // The offer is sent once the page has hydrated and listens, so it is repeated until it lands.
    const tip = page.getByRole("region", { name: "Install Dayboard" });
    await expect(async () => {
      await offerInstall(page);
      await expect(tip).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });

    await tip.getByRole("button", { name: "Not now" }).click();
    await expect(tip).toHaveCount(0);

    // Another open, another session, a fourth visit: no tip, and it stays dismissed.
    await page.evaluate(() => sessionStorage.removeItem("pwa:visitCounted"));
    await page.reload();
    await expect(page).toHaveURL(/\/today/);
    // Give the page time to hydrate and offer the install, then check the tip stays away.
    await page.waitForLoadState("networkidle");
    await offerInstall(page);
    await page.waitForTimeout(500);
    await expect(page.getByRole("region", { name: "Install Dayboard" })).toHaveCount(0);
  });
});
