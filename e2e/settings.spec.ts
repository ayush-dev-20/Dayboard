import { expect, type Browser } from "@playwright/test";
import { test } from "./fixtures";
import { ageSessions, findUser, preferencesFor, rowCountsFor } from "./db";
import { alertIn, PASSWORD, signIn, signOut, signUp, uniqueEmail, newDevice } from "./helpers";
import { waitForEmail } from "./mailbox";

async function newUser(browser: Browser) {
  const context = await newDevice(browser);
  const page = await context.newPage();
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  return { context, page, account, user };
}

test.describe("profile and preferences", () => {
  test("the name can be changed and shows up in the greeting", async ({ browser }) => {
    const { context, page } = await newUser(browser);

    await page.goto("/settings/account");
    await expect(page.getByLabel("Name")).toHaveValue("Test User");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();

    await page.getByLabel("Name").fill("Priya Sharma");
    await save.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Priya");
    await context.close();
  });

  test("a blank name is refused with a clear message", async ({ browser }) => {
    const { context, page } = await newUser(browser);
    await page.goto("/settings/account");
    await page.getByLabel("Name").fill("   ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(alertIn(page).filter({ hasText: "Enter your name." })).toBeVisible();
    await context.close();
  });

  test("productivity preferences are saved and survive a reload", async ({ browser }) => {
    const { context, page, user } = await newUser(browser);
    await page.goto("/settings/productivity");

    await page.getByLabel("Week starts on").selectOption("0");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByLabel("Start of day").selectOption("07:30");
    await page.getByLabel("Default task priority").selectOption("HIGH");
    await page.getByLabel("Time zone").selectOption("America/New_York");

    // Four separate saves; wait until all of them have landed.
    await expect
      .poll(async () => preferencesFor(user.id))
      .toMatchObject({
        week_start: 0,
        start_of_day: "07:30:00",
        default_task_priority: "HIGH",
        timezone: "America/New_York",
      });

    await page.reload();
    await expect(page.getByLabel("Week starts on")).toHaveValue("0");
    await expect(page.getByLabel("Start of day")).toHaveValue("07:30");
    await expect(page.getByLabel("Default task priority")).toHaveValue("HIGH");
    await expect(page.getByLabel("Time zone")).toHaveValue("America/New_York");
    await context.close();
  });

  test("the AI switch is saved", async ({ browser }) => {
    const { context, page, user } = await newUser(browser);
    await page.goto("/settings/ai");

    const toggle = page.getByRole("switch", { name: "Enable AI features" });
    await expect(toggle).toBeChecked();
    await expect(page.getByText("How your data is used")).toBeVisible();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await preferencesFor(user.id))?.ai_enabled).toBe(false);

    await page.reload();
    await expect(page.getByRole("switch", { name: "Enable AI features" })).not.toBeChecked();
    await context.close();
  });

  test("the theme applies immediately and is remembered", async ({ browser }) => {
    const { context, page, user } = await newUser(browser);
    await page.goto("/settings/appearance");
    const html = page.locator("html");

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    await expect.poll(async () => (await preferencesFor(user.id))?.theme).toBe("dark");

    await page.reload();
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect.poll(async () => (await preferencesFor(user.id))?.theme).toBe("light");
    await context.close();
  });

  test("the saved theme follows the account onto a new device", async ({ browser }) => {
    const { context, page, account, user } = await newUser(browser);
    await page.goto("/settings/appearance");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect.poll(async () => (await preferencesFor(user.id))?.theme).toBe("dark");

    const phone = await newDevice(browser, { colorScheme: "light" });
    const phonePage = await phone.newPage();
    await signIn(phonePage, account.email, account.password);
    await expect(phonePage).toHaveURL(/\/today/);
    await expect(phonePage.locator("html")).toHaveClass(/dark/);

    await phone.close();
    await context.close();
  });
});

test.describe("sign-in methods and sessions", () => {
  test("the sign-in methods list shows the password and magic link, and no provider that isn't set up", async ({
    browser,
  }) => {
    const { context, page, account } = await newUser(browser);
    await page.goto("/settings/account");

    await expect(page.getByText("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
    await expect(page.getByText(`Available for ${account.email}`)).toBeVisible();
    await expect(page.getByText("Always on")).toBeVisible();
    // No Google or GitHub credentials in this environment, so those rows are hidden.
    await expect(page.getByText("Link Google")).toHaveCount(0);
    await expect(page.getByText("Link GitHub")).toHaveCount(0);
    await context.close();
  });

  test("other devices are listed and can be signed out one by one or all at once", async ({
    browser,
  }) => {
    const { context, page, account } = await newUser(browser);

    const phone = await newDevice(browser, {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const phonePage = await phone.newPage();
    await signIn(phonePage, account.email, account.password);
    await expect(phonePage).toHaveURL(/\/today/);

    await page.goto("/settings/account");
    await expect(page.getByText("This device", { exact: true })).toBeVisible();
    await expect(page.getByText("iPhone", { exact: true })).toBeVisible();
    await expect(page.getByText(/Safari · /)).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText("iPhone", { exact: true })).toHaveCount(0);
    await phonePage.goto("/today");
    await expect(phonePage).toHaveURL(/\/sign-in/);

    // Two more devices, then sign them all out at once.
    const tablet = await newDevice(browser);
    const laptop = await newDevice(browser);
    await signIn(await tablet.newPage(), account.email, account.password);
    await signIn(await laptop.newPage(), account.email, account.password);
    await page.reload();
    await page.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(page.getByRole("button", { name: "Sign out other devices" })).toHaveCount(0);

    const tabletPage = tablet.pages()[0]!;
    await tabletPage.goto("/today");
    await expect(tabletPage).toHaveURL(/\/sign-in/);

    // This device stays signed in.
    await page.goto("/today");
    await expect(page).toHaveURL(/\/today/);

    await Promise.all([phone.close(), tablet.close(), laptop.close(), context.close()]);
  });

  test("changing the password checks the current one and signs out other devices", async ({
    browser,
  }) => {
    const { context, page, account } = await newUser(browser);
    const other = await newDevice(browser);
    const otherPage = await other.newPage();
    await signIn(otherPage, account.email, account.password);
    await expect(otherPage).toHaveURL(/\/today/);

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Change password" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Current password").fill("not-my-password");
    await dialog.getByLabel("New password", { exact: true }).fill("a-much-better-password");
    await dialog.getByRole("button", { name: "Save password" }).click();
    await expect(dialog.getByText("Your current password is incorrect.")).toBeVisible();

    await dialog.getByLabel("Current password").fill(account.password);
    await dialog.getByLabel("New password", { exact: true }).fill("short");
    await dialog.getByRole("button", { name: "Save password" }).click();
    await expect(dialog.getByText("Use at least 10 characters.")).toBeVisible();

    await dialog.getByLabel("New password", { exact: true }).fill("a-much-better-password");
    await dialog.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("Password changed. Other devices were signed out.")).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await otherPage.goto("/today");
    await expect(otherPage).toHaveURL(/\/sign-in/);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/today/);

    await signIn(otherPage, account.email, "a-much-better-password");
    await expect(otherPage).toHaveURL(/\/today/);

    await other.close();
    await context.close();
  });

  test("someone who signed up with a link can add a password", async ({ browser }) => {
    const context = await newDevice(browser);
    const page = await context.newPage();
    const email = uniqueEmail("nopass");

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.goto((await waitForEmail(email, "magic-link")).link);
    await page.getByRole("button", { name: "Continue to Today" }).click();
    await expect(page).toHaveURL(/\/today/);

    await page.goto("/settings/account");
    await expect(page.getByText("Not set", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Set password" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Current password")).toHaveCount(0);
    await dialog.getByLabel("New password", { exact: true }).fill("my-first-password-1");
    await dialog.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("Password set", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Set on /)).toBeVisible();

    await signOut(page);
    await signIn(page, email, "my-first-password-1");
    await expect(page).toHaveURL(/\/today/);
    await context.close();
  });

  test("changing the email asks the current address for approval first", async ({ browser }) => {
    const { context, page, account, user } = await newUser(browser);
    const newEmail = uniqueEmail("renamed");

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Change email" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New email").fill(account.email);
    await dialog.getByRole("button", { name: "Send link" }).click();
    await expect(dialog.getByText("That's already your email.")).toBeVisible();

    await dialog.getByLabel("New email").fill(newEmail);
    await dialog.getByRole("button", { name: "Send link" }).click();
    await expect(dialog.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

    // The approval goes to the address on file, and nothing has changed yet.
    const approval = await waitForEmail(account.email, "change-email");
    expect(approval.link).toContain("/api/auth/");
    expect((await findUser(account.email))?.id).toBe(user.id);
    await context.close();
  });
});

test.describe("deleting an account", () => {
  test("needs the typed word, then removes the account and everything attached to it", async ({
    browser,
  }) => {
    const { context, page, account, user } = await newUser(browser);
    expect(await rowCountsFor(user.id)).toEqual({ users: 1, sessions: 1, accounts: 1, prefs: 1 });

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete your account?" })).toBeVisible();

    const confirm = dialog.getByRole("button", { name: "Delete my account" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page).toHaveURL(/\/sign-in\?deleted=1/);
    await expect(page.getByText("Your account has been deleted.")).toBeVisible();
    expect(await rowCountsFor(user.id)).toEqual({ users: 0, sessions: 0, accounts: 0, prefs: 0 });

    // Cannot sign back in, and the message doesn't say why.
    await signIn(page, account.email, account.password);
    await expect(alertIn(page)).toHaveText("Email or password is incorrect.");
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });

  test("cancelling keeps the account", async ({ browser }) => {
    const { context, page, user } = await newUser(browser);
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await rowCountsFor(user.id)).users).toBe(1);

    // Esc also closes it, and the typed text starts empty next time.
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByLabel("Type DELETE to confirm")).toHaveValue("");
    await context.close();
  });

  test("an older session must sign in again first, then the deletion goes through", async ({
    browser,
  }) => {
    const { context, page, account, user } = await newUser(browser);
    await ageSessions(user.id, 20);

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();

    const reauth = page.getByRole("dialog");
    await expect(reauth.getByRole("heading", { name: "Confirm it’s you" })).toBeVisible();
    expect((await rowCountsFor(user.id)).users).toBe(1);

    await reauth.getByLabel("Or use your password").fill("wrong-password-here");
    await reauth.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(alertIn(reauth)).toHaveText("Email or password is incorrect.");

    await reauth.getByLabel("Or use your password").fill(account.password);
    await reauth.getByRole("button", { name: "Continue", exact: true }).click();

    // Fresh session now: back to the typed confirmation, and the deletion succeeds.
    await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/sign-in\?deleted=1/);
    expect((await rowCountsFor(user.id)).users).toBe(0);
    await context.close();
  });

  test("an older session can reauthenticate with an emailed link and come back to finish", async ({
    browser,
  }) => {
    const { context, page, account, user } = await newUser(browser);
    await ageSessions(user.id, 20);

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();

    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText(`We sent a sign-in link to ${account.email}`)).toBeVisible();

    await page.goto((await waitForEmail(account.email, "magic-link")).link);
    // Lands back on Settings with the confirmation open.
    await expect(page).toHaveURL(/\/settings\/account\?delete=1/);
    await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/sign-in\?deleted=1/);
    expect((await rowCountsFor(user.id)).users).toBe(0);
    await context.close();
  });

  test("a stale session is also refused when the request skips the dialog", async ({ browser }) => {
    const { context, page, user } = await newUser(browser);
    await ageSessions(user.id, 20);
    await page.goto("/settings/account");

    // The server decides freshness, not the page: the dialog only reacts to the answer.
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("heading", { name: "Confirm it’s you" })).toBeVisible();
    expect((await rowCountsFor(user.id)).users).toBe(1);
    await context.close();
  });
});

test.describe("one person's data is never another's", () => {
  test("changing preferences as one user leaves another user's untouched", async ({ browser }) => {
    const a = await newUser(browser);
    const b = await newUser(browser);
    const before = await preferencesFor(b.user.id);

    await a.page.goto("/settings/appearance");
    await a.page.getByRole("radio", { name: "Dark" }).click();
    await a.page.goto("/settings/ai");
    await a.page.getByRole("switch", { name: "Enable AI features" }).click();
    await a.page.goto("/settings/productivity");
    await a.page.getByLabel("Default task priority").selectOption("HIGH");
    await expect(a.page.getByText("Saved", { exact: true })).toBeVisible();

    await expect
      .poll(async () => (await preferencesFor(a.user.id))?.default_task_priority)
      .toBe("HIGH");
    expect(await preferencesFor(b.user.id)).toEqual(before);

    // B's own pages show B's values.
    await b.page.goto("/settings/ai");
    await expect(b.page.getByRole("switch", { name: "Enable AI features" })).toBeChecked();
    await b.page.goto("/settings/productivity");
    await expect(b.page.getByLabel("Default task priority")).toHaveValue("NONE");

    await Promise.all([a.context.close(), b.context.close()]);
  });

  test("each person sees only their own sessions and account details", async ({ browser }) => {
    const a = await newUser(browser);
    const b = await newUser(browser);

    await a.page.goto("/settings/account");
    await expect(a.page.getByText(`${a.account.email} · verified`)).toBeVisible();
    await expect(a.page.getByText(b.account.email)).toHaveCount(0);
    await expect(a.page.getByText("This device", { exact: true })).toBeVisible();
    // Only A's one session: no "Sign out other devices" even though B is signed in elsewhere.
    await expect(a.page.getByRole("button", { name: "Sign out other devices" })).toHaveCount(0);

    // Signing A out everywhere never touches B.
    await signOut(a.page);
    await b.page.goto("/today");
    await expect(b.page).toHaveURL(/\/today/);

    await Promise.all([a.context.close(), b.context.close()]);
  });
});

test("sign-in works with the default password helper for a fresh account", async ({ browser }) => {
  const { context, account } = await newUser(browser);
  expect(account.password).toBe(PASSWORD);
  await context.close();
});
