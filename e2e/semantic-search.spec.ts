import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertNote, insertTask } from "./db";
import { signUp } from "./helpers";

// V2 feature 10 end to end, with the mock embedder (it knows that "login", "OTP" and "authentication" are
// related). Background jobs are run through tick mode, exactly as production does.

const TICK = { authorization: "Bearer e2e-tick-secret-0123456789abcdefghijkl" };

test.use({ viewport: { width: 1280, height: 900 } });

async function runJobs(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const response = await page.request.post("/api/jobs/tick", { headers: TICK });
    expect(response.ok()).toBe(true);
  }
}

test("search by meaning: turn on, index, find a note without its words, turn off", async ({
  page,
}) => {
  test.slow();
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  await insertNote(user.id, {
    title: "Sprint retro",
    text: "Login failures with OTP codes after the update",
  });
  await insertNote(user.id, { title: "Lunch", text: "Plan the team lunch on Friday" });
  await insertTask(user.id, { title: "Rotate the password reset token" });

  // Off by default: a meaning-only search finds nothing, and the page offers to turn it on.
  await page.goto("/search?q=authentication%20problems");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await expect(page.getByRole("link", { name: "Turn on search by meaning" })).toBeVisible();

  // Turn it on in Settings, start indexing now, and let the jobs run.
  await page.goto("/settings/ai");
  await page.getByRole("switch", { name: "Search by meaning" }).click();
  await expect(page.getByTestId("index-status")).toBeVisible();
  await page.getByRole("button", { name: "Start now" }).click();
  await expect(page.getByText("Indexing started.")).toBeVisible();
  await runJobs(page);
  await page.reload();
  await expect(page.getByTestId("index-status")).toContainText("3 of 3 items indexed");

  // The note is found by meaning, labelled, and explains itself.
  await page.goto("/search?q=authentication%20problems");
  const row = page.getByRole("listitem").filter({ hasText: "Sprint retro" });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("match-kind")).toHaveText("Related meaning");
  await expect(page.getByRole("listitem").filter({ hasText: "Lunch" })).toHaveCount(0);
  await row.getByText("Why this result").click();
  await expect(row.getByText(/meaning is close to your search/)).toBeVisible();

  // The related task is found from different words.
  await page.goto("/search?q=OTP%20security");
  await expect(
    page.getByRole("listitem").filter({ hasText: "password reset token" }),
  ).toBeVisible();

  // A quoted phrase is an exact match.
  await page.goto("/search?q=%22OTP%20codes%22");
  const phrase = page.getByRole("listitem").filter({ hasText: "Sprint retro" });
  await expect(phrase.getByTestId("match-kind")).toHaveText("Phrase");

  // Opening an item puts it first under recent items in the command menu.
  await page.getByRole("link", { name: /Sprint retro/ }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.goto("/today");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog").getByRole("option", { name: /Sprint retro/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Off again: the index is deleted and meaning-only searches find nothing.
  await page.goto("/settings/ai");
  await page.getByRole("switch", { name: "Search by meaning" }).click();
  await expect(page.getByTestId("index-status")).toHaveCount(0);
  await page.goto("/search?q=authentication%20problems");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});
