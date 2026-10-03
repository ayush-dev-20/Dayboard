import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertInboxItem, insertNote, insertProject, insertTask, insertTodo } from "./db";
import { newDevice, signUp, today } from "./helpers";

// Feature 07 §11.2: axe on every screen, light and dark. Zero serious or critical violations,
// including color contrast. (The contrast unit test checks the tokens; this checks real pages.)

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
  "/settings/account",
  "/settings/appearance",
  "/settings/productivity",
  "/settings/ai",
];
const PUBLIC = ["/", "/sign-in", "/sign-up", "/privacy", "/terms", "/this-page-does-not-exist"];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const report = serious.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 5)
        .map((n) => `   ${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n")}`,
  );
  expect(report, `${label}\n${report.join("\n")}`).toEqual([]);
}

async function seed(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  const project = await insertProject(user.id, { name: "Acme rebrand", color: "teal" });
  const late = await insertTask(user.id, {
    title: "Send invoice",
    dueDate: today(-12),
    priority: "HIGH",
  });
  await insertTask(user.id, { title: "Renew domain", dueDate: today(-2) });
  await insertTask(user.id, { title: "Draft roadmap", dueDate: today(), priority: "MEDIUM" });
  await insertTask(user.id, { title: "Plan the offsite", dueDate: today(5) });
  await insertTodo(user.id, { title: "Buy oat milk" });
  await insertNote(user.id, {
    title: "Invoice notes",
    text: "The invoice is due. Ask about the budget.",
    projectId: project,
  });
  await insertInboxItem(user.id, "Look into standing desks");
  const { setTaskProject } = await import("./db");
  await setTaskProject(late, project);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme });

    test(`signed-in screens have no serious violations (${colorScheme})`, async ({ page }) => {
      test.setTimeout(180_000);
      await seed(page);
      for (const path of SIGNED_IN) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await scan(page, `${colorScheme} ${path}`);
      }
      // Open surfaces: the command menu and a task panel.
      await page.goto("/tasks");
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `${colorScheme} command menu`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Send invoice", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "Task detail" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scan(page, `${colorScheme} task panel`);
    });

    test(`public screens have no serious violations (${colorScheme})`, async ({ browser }) => {
      const context = await newDevice(browser, {
        colorScheme,
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      for (const path of PUBLIC) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await scan(page, `${colorScheme} ${path}`);
      }
      await context.close();
    });

    test(`onboarding has no serious violations (${colorScheme})`, async ({ page }) => {
      await signUp(page, { onboard: false });
      for (let step = 0; step < 3; step += 1) {
        await scan(page, `${colorScheme} onboarding step ${step + 1}`);
        if (step < 2) await page.getByRole("button", { name: "Next" }).click();
      }
    });
  });
}
