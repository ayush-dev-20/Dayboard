import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { signIn, signOut, signUp, newDevice } from "./helpers";

const PLACEHOLDER_PAGES = [
  { path: "/inbox", title: "Inbox" },
  { path: "/notes", title: "Notes" },
  { path: "/projects", title: "Projects" },
  { path: "/search", title: "Search" },
  { path: "/trash", title: "Trash" },
];

test("the health endpoint reports the app and database are up", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", db: "ok" });
});

test.describe("signed in, desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the sidebar reaches every part of the app and marks where you are", async ({ page }) => {
    await signUp(page);
    const sidebar = page.getByRole("complementary");
    const primary = sidebar.getByRole("navigation", { name: "Primary" });

    for (const label of [
      "Today",
      "Inbox",
      "Tasks",
      "Notes",
      "Projects",
      "Search",
      "Trash",
      "Settings",
    ]) {
      await expect(primary.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(primary.getByRole("link", { name: "Today" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    for (const { path, title } of PLACEHOLDER_PAGES) {
      await primary.getByRole("link", { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(primary.getByRole("link", { name: title })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: `${title} is on its way` }),
      ).toBeVisible();
    }

    // Tasks is a real page now (feature 02); it is covered in depth by tasks.spec.ts.
    await primary.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(primary.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();

    await primary.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/account/);
    await expect(primary.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("every page has exactly one top-level heading", async ({ page }) => {
    await signUp(page);
    const routes = [
      "/today",
      ...PLACEHOLDER_PAGES.map((p) => p.path),
      "/more",
      "/settings/account",
      "/settings/appearance",
      "/settings/productivity",
      "/settings/ai",
    ];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }), route).toHaveCount(1);
    }
  });

  test("the top bar shows the account menu, and Settings and Sign out work from it", async ({
    page,
  }) => {
    const account = await signUp(page, { name: "Ayush Khakharia" });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu").getByText("Ayush Khakharia")).toBeVisible();
    await expect(page.getByRole("menu").getByText(account.email)).toBeVisible();

    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/account/);

    await signOut(page);
    await signIn(page, account.email, account.password);
    await expect(page).toHaveURL(/\/today/);
  });

  test("features that arrive later are visible but switched off", async ({ page }) => {
    await signUp(page);
    await expect(page.getByRole("button", { name: /Search, ask or create/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Quick capture" }).first()).toBeDisabled();
  });

  test("the settings tabs switch between sections", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/account/);

    const tabs = page.getByRole("navigation", { name: "Settings sections" });
    for (const [label, path] of [
      ["Appearance", "appearance"],
      ["Productivity", "productivity"],
      ["AI", "ai"],
      ["Account", "account"],
    ] as const) {
      await tabs.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${path}`));
      await expect(tabs.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("unknown pages get a friendly not-found screen", async ({ page }) => {
    await signUp(page);
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await page.getByRole("link", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 900, height: 700 } });

  test("the sidebar becomes a sheet that opens from the menu button and closes on Escape or a choice", async ({
    page,
  }) => {
    await signUp(page);
    await expect(page.getByRole("complementary")).toBeHidden();

    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Inbox" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Notes" }).click();
    await expect(page).toHaveURL(/\/notes/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("keyboard and theme", () => {
  test("the sign-in form can be completed from the keyboard alone", async ({ browser }) => {
    const setup = await newDevice(browser);
    const account = await signUp(await setup.newPage());
    await setup.close();

    const context = await newDevice(browser);
    const page = await context.newPage();
    await page.goto("/sign-in");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(account.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(account.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/today/);
    await context.close();
  });

  test("password visibility can be toggled and keeps the value", async ({ page }) => {
    await page.goto("/sign-in");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("hunter2-hunter2");
    await expect(password).toHaveAttribute("type", "password");

    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("hunter2-hunter2");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a device set to dark mode gets the dark theme until the account says otherwise", async ({
    browser,
  }) => {
    const context = await newDevice(browser, { colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveClass(/dark/);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // Warm charcoal, never pure black.
    expect(background).toBe("rgb(21, 18, 14)");
    await context.close();
  });

  test("the light theme uses the warm paper tone, never pure white", async ({ browser }) => {
    const context = await newDevice(browser, { colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/sign-in");
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe("rgb(250, 248, 242)");
    await context.close();
  });
});
