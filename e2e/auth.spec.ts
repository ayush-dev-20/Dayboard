import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, preferencesFor } from "./db";
import { alertIn, PASSWORD, signIn, signOut, signUp, uniqueEmail, newDevice } from "./helpers";
import { emailsFor, waitForEmail } from "./mailbox";

test.describe("sign up and verification", () => {
  test("a new person signs up, verifies their email, onboards and lands on Today", async ({
    page,
  }) => {
    const email = uniqueEmail("signup");
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Ayush Khakharia");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // Not signed in yet: they are asked to verify first.
    await expect(page).toHaveURL(/\/verify-email\?email=/);
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend email" })).toBeDisabled();

    const verification = await waitForEmail(email, "verify-email");
    await page.goto(verification.link);

    // Verified and signed in, but not onboarded, so the app sends them to onboarding.
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: "Welcome to Dayboard" })).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue("Ayush Khakharia");

    await page.getByRole("button", { name: "Continue to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ayush");

    const user = await findUser(email);
    expect(user?.email_verified).toBe(true);
    const prefs = await preferencesFor(user!.id);
    expect(prefs?.onboarded_at).not.toBeNull();
    expect(prefs?.theme).toBe("system");
  });

  test("onboarding saves the detected time zone and the chosen theme", async ({ browser }) => {
    const context = await newDevice(browser, { timezoneId: "Asia/Kolkata" });
    const page = await context.newPage();
    const account = await signUp(page, { onboard: false });

    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Kolkata");
    // Onboarding has three steps (feature 07): the theme is chosen on the second.
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("radio", { name: "Dark" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Continue to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.locator("html")).toHaveClass(/dark/);

    const prefs = await preferencesFor((await findUser(account.email))!.id);
    expect(prefs?.timezone).toBe("Asia/Kolkata");
    expect(prefs?.theme).toBe("dark");
    await context.close();
  });

  test("an unverified account cannot sign in and is sent back to verification", async ({
    page,
  }) => {
    const email = uniqueEmail("unverified");
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Unverified");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify-email/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/verify-email\?email=/);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign-up checks each field and explains what is wrong", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("signing up with an existing email reveals nothing about that account", async ({
    browser,
    page,
  }) => {
    const existing = await newDevice(browser);
    const account = await signUp(await existing.newPage());
    await existing.close();

    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Someone Else");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill("a-different-password-1");
    await page.getByRole("button", { name: "Create account" }).click();

    // Same screen as a brand-new sign-up; no "already registered" message.
    await expect(page).toHaveURL(/\/verify-email/);
    await expect(page.getByText(/already/i)).toHaveCount(0);
  });
});

test.describe("signing in and out", () => {
  test("sign out, then sign in again", async ({ page }) => {
    const account = await signUp(page);

    await signOut(page);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftoday/);

    await signIn(page, account.email, account.password);
    await expect(page).toHaveURL(/\/today/);
  });

  test("a wrong password gets a generic message", async ({ browser, page }) => {
    const context = await newDevice(browser);
    const account = await signUp(await context.newPage());
    await context.close();

    await signIn(page, account.email, "definitely-the-wrong-one");
    await expect(alertIn(page)).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/sign-in/);

    // An address with no account looks exactly the same.
    await signIn(page, uniqueEmail("ghost"), "definitely-the-wrong-one");
    await expect(alertIn(page)).toHaveText("Email or password is incorrect.");
  });

  test("a private page asks you to sign in, then brings you back to it", async ({
    browser,
    page,
  }) => {
    const context = await newDevice(browser);
    const account = await signUp(await context.newPage());
    await context.close();

    await page.goto("/settings/productivity");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Fproductivity/);

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/productivity/);
  });

  test("a hostile next parameter cannot send you off-site", async ({ browser, page }) => {
    const context = await newDevice(browser);
    const account = await signUp(await context.newPage());
    await context.close();

    await page.goto("/sign-in?next=//evil.example/steal");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/today/);
    expect(new URL(page.url()).host).toBe(
      new URL(test.info().project.use.baseURL ?? page.url()).host,
    );
  });

  test("signed-in visitors skip the sign-in and sign-up pages", async ({ page }) => {
    await signUp(page);
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/today/);
    await page.goto("/sign-up");
    await expect(page).toHaveURL(/\/today/);
  });

  test("private pages are closed to signed-out visitors", async ({ page }) => {
    for (const path of [
      "/today",
      "/inbox",
      "/tasks",
      "/notes",
      "/projects",
      "/search",
      "/trash",
      "/settings",
      "/more",
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/sign-in\?next=/);
    }
    const session = await page.request.get("/api/auth/get-session");
    expect(await session.json()).toBeNull();
  });
});

test.describe("password reset", () => {
  test("reset by email, which signs out other devices, and the link works only once", async ({
    browser,
  }) => {
    const deviceA = await newDevice(browser);
    const pageA = await deviceA.newPage();
    const account = await signUp(pageA);

    const deviceB = await newDevice(browser);
    const pageB = await deviceB.newPage();
    await pageB.goto("/forgot-password");
    await pageB.getByLabel("Email").fill(account.email);
    await pageB.getByRole("button", { name: "Send reset link" }).click();
    await expect(pageB.getByText("If an account exists for that email")).toBeVisible();

    const reset = await waitForEmail(account.email, "reset-password");
    await pageB.goto(reset.link);
    await expect(pageB.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    await pageB.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
    await pageB.getByLabel("Confirm new password").fill("a-brand-new-password");
    await pageB.getByRole("button", { name: "Update password" }).click();
    await expect(pageB).toHaveURL(/\/sign-in\?reset=1/);
    await expect(pageB.getByText("Password updated.")).toBeVisible();

    // Device A was signed in before the reset, so its session is gone.
    await pageA.goto("/today");
    await expect(pageA).toHaveURL(/\/sign-in/);

    // The old password no longer works; the new one does.
    await signIn(pageB, account.email, account.password);
    await expect(alertIn(pageB)).toHaveText("Email or password is incorrect.");
    await signIn(pageB, account.email, "a-brand-new-password");
    await expect(pageB).toHaveURL(/\/today/);

    // Using the same link again fails.
    await pageB.goto(reset.link);
    await expect(pageB.getByRole("heading", { name: "This link has expired" })).toBeVisible();

    await deviceA.close();
    await deviceB.close();
  });

  test("asking for a reset for an unknown address looks the same and sends nothing", async ({
    page,
  }) => {
    const email = uniqueEmail("nobody");
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If an account exists for that email")).toBeVisible();

    await page.waitForTimeout(1000);
    expect(await emailsFor(email, "reset-password")).toHaveLength(0);
  });

  test("a reset link with a bad token shows the expired screen", async ({ page }) => {
    await page.goto("/reset-password?token=not-a-real-token");
    await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
    await page.getByLabel("Confirm new password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();

    await page.goto("/reset-password?error=INVALID_TOKEN");
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await page.getByRole("link", { name: "Request a new link" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test("the new password must match its confirmation", async ({ page }) => {
    await page.goto("/reset-password?token=anything");
    await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
    await page.getByLabel("Confirm new password").fill("something-different");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Those passwords don't match.")).toBeVisible();
  });
});

test.describe("magic link", () => {
  test("a new person signs in with a link, and the link works only once", async ({ page }) => {
    const email = uniqueEmail("magic");

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/magic-link-sent\?email=/);
    await expect(page.getByText("It is valid for 10 minutes and works once.")).toBeVisible();

    const magic = await waitForEmail(email, "magic-link");
    await page.goto(magic.link);

    // A brand-new account goes through onboarding; the name starts from the email.
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByLabel("Your name")).toHaveValue(email.split("@")[0]!);
    await page.getByRole("button", { name: "Continue to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    expect((await findUser(email))?.email_verified).toBe(true);

    await signOut(page);
    await page.goto(magic.link);
    await expect(page).toHaveURL(/\/sign-in\?error=/);
    await expect(alertIn(page)).toContainText("expired or was already used");
  });

  test("an existing account signs in with a link instead of creating a second one", async ({
    browser,
    page,
  }) => {
    const context = await newDevice(browser);
    const account = await signUp(await context.newPage());
    await context.close();
    const before = await findUser(account.email);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    const magic = await waitForEmail(account.email, "magic-link");
    await page.goto(magic.link);

    await expect(page).toHaveURL(/\/today/);
    expect((await findUser(account.email))?.id).toBe(before?.id);
  });

  test("asks for an email before sending a link", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Enter your email first")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
  });
});

test("repeated failed sign-ins from one address are slowed down", async ({ page }) => {
  // Five attempts a minute are allowed; the sixth is refused with a plain message.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await signIn(page, uniqueEmail("limit"), "wrong-password-here");
    await expect(alertIn(page)).toHaveText("Email or password is incorrect.");
  }
  await signIn(page, uniqueEmail("limit"), "wrong-password-here");
  await expect(alertIn(page)).toHaveText("Too many attempts. Try again in a minute.");
});

test("signing in with nothing filled in explains what is missing", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});
