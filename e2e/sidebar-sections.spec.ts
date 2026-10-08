import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertProject } from "./db";
import { signUp } from "./helpers";

// The project list under Projects in the sidebar folds away with a chevron on its row, and the
// choice is remembered on this device (shown unless folded).

test.use({ viewport: { width: 1280, height: 800 } });

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test("the projects in the sidebar fold away, stay folded after a reload, and open again", async ({
  page,
}) => {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  await insertProject(user.id, { name: "Launch" });
  await insertProject(user.id, { name: "Garden" });
  await page.goto("/today");

  await expect(sidebar(page).getByRole("link", { name: "Launch" })).toBeVisible();
  await page.getByRole("button", { name: "Hide projects" }).click();
  await expect(sidebar(page).getByRole("link", { name: "Launch" })).toHaveCount(0);
  // The Projects link itself stays.
  await expect(sidebar(page).getByRole("link", { name: "Projects", exact: true })).toBeVisible();

  await page.reload();
  await expect(sidebar(page).getByRole("link", { name: "Launch" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show projects" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.getByRole("button", { name: "Show projects" }).click();
  await expect(sidebar(page).getByRole("link", { name: "Garden" })).toBeVisible();
});

test("a person with no projects sees no chevron", async ({ page }) => {
  await signUp(page);
  await page.goto("/today");
  await expect(page.getByRole("button", { name: /(Hide|Show) projects/ })).toHaveCount(0);
});
