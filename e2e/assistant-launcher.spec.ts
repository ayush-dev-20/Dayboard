import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  auditRows,
  findUser,
  insertNote,
  insertProject,
  insertTask,
  setAiEnabled,
  setAssistantLauncher,
  setTaskProject,
  taskByTitle,
} from "./db";
import { signUp } from "./helpers";

// V2 feature 11 §6A: the floating chat button, its panel, and asking about one item by dropping it
// on the button (or from a menu). Mock provider: no network, no key, no cost.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const launcher = (page: Page) =>
  page.getByRole("button", { name: /Ask your workspace|Drop to ask/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Assistant" });
const composer = (page: Page) =>
  panel(page).getByRole("textbox", { name: "Message the assistant" });

async function ask(page: Page, question: string) {
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(panel(page).getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(panel(page).getByTestId("user-message").last()).toContainText(question);
}

test.describe("the floating chat button", () => {
  test("sits at the bottom right, opens a panel that stays open, closes with Esc and the shortcut", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Roadmap", text: "Roadmap includes billing and hosting." });
    await page.goto("/today");
    const button = launcher(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // Bottom right of the window, 56px.
    const box = (await button.boundingBox())!;
    expect(box.width).toBeCloseTo(56, 0);
    expect(box.x + box.width).toBeGreaterThan(1280 - 60);
    expect(box.y + box.height).toBeGreaterThan(900 - 60);

    await button.click();
    await expect(panel(page)).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(composer(page)).toBeFocused();

    // Clicking the page does not close it (items are dragged in while it is open).
    await page.getByRole("main").click({ position: { x: 20, y: 20 } });
    await expect(panel(page)).toBeVisible();

    await ask(page, "roadmap billing");
    await expect(panel(page).getByTestId("assistant-message")).toContainText("Roadmap");

    // Esc closes it and gives focus back to the button; the shortcut opens and closes it.
    await composer(page).press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(button).toBeFocused();
    await page.keyboard.press("ControlOrMeta+.");
    await expect(panel(page)).toBeVisible();
    // The conversation is still there.
    await expect(panel(page).getByTestId("user-message")).toContainText("roadmap billing");
    await page.keyboard.press("ControlOrMeta+.");
    await expect(panel(page)).toBeHidden();
  });

  test("Open full page continues the same thread; the button is not on the Assistant page", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Hosting plan", text: "Hosting plan covers servers." });
    await page.goto("/today");
    await launcher(page).click();
    await ask(page, "hosting plan");
    await panel(page).getByRole("link", { name: "Open full page" }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByTestId("assistant-chat").getByTestId("user-message")).toContainText(
      "hosting plan",
    );
    await expect(page.getByRole("button", { name: "Ask your workspace" })).toHaveCount(0);
  });

  test("it can be hidden in Settings and by turning AI off, and the page keeps working", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/settings/ai");
    const toggle = page.getByRole("switch", { name: "Show the chat button" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await page.request.get("/today")).ok()).toBe(true);
    await page.goto("/today");
    await expect(page.getByRole("button", { name: "Ask your workspace" })).toHaveCount(0);
    // The page, and the sidebar item, are still there.
    await page.goto("/assistant");
    await expect(page.getByTestId("assistant-chat")).toBeVisible();

    await setAssistantLauncher(user.id, true);
    await setAiEnabled(user.id, false);
    await page.goto("/today");
    await expect(page.getByRole("button", { name: "Ask your workspace" })).toHaveCount(0);
  });

  test("it keeps to the left of the docked task panel, and above the phone's bottom navigation", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Open me" });
    await page.goto(`/tasks?task=${taskId}`);
    await expect(page.getByRole("button", { name: "Minimize task" })).toBeVisible();
    const box = (await launcher(page).boundingBox())!;
    const panelBox = await page.getByRole("button", { name: "Minimize task" }).evaluate((el) => {
      const aside = el.closest("aside")!;
      const r = aside.getBoundingClientRect();
      return { x: r.x, width: r.width };
    });
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/today");
    const phone = (await launcher(page).boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    expect(phone.y + phone.height).toBeLessThanOrEqual(nav.y);
    await launcher(page).click();
    const sheetBox = (await panel(page).boundingBox())!;
    expect(sheetBox.height).toBeGreaterThan(800 * 0.85);
    expect(sheetBox.width).toBeGreaterThanOrEqual(359);
  });
});

test.describe("asking about one item", () => {
  test("Ask about this in the note menu starts a chat with a visible, removable chip; answers come from that note only", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const mine = await insertNote(user.id, {
      title: "Roadmap draft",
      text: "Roadmap goals: hosting migration and billing.",
    });
    await insertNote(user.id, {
      title: "Other roadmap",
      text: "Roadmap also mentions a secret hosting plan.",
    });
    await page.goto(`/notes/${mine}`);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ask about this" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(panel(page).getByTestId("chips")).toContainText("Roadmap draft");
    await ask(page, "summarize the roadmap hosting");
    await expect(panel(page).getByTestId("assistant-message")).toContainText("Roadmap draft");
    await expect(panel(page)).not.toContainText("secret hosting plan");

    // Remove the chip: the next question searches everything.
    await panel(page)
      .getByRole("button", { name: /Remove Roadmap draft/ })
      .click();
    await expect(panel(page).getByTestId("chips")).toHaveCount(0);
    await ask(page, "other roadmap");
    await expect(panel(page).getByTestId("assistant-message").last()).toContainText(
      "Other roadmap",
    );
  });

  test("a task and a project menu do the same, and the empty panel offers the page you are on", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const project = await insertProject(user.id, { name: "Launch plan" });
    const taskId = await insertTask(user.id, { title: "Order banners" });
    await setTaskProject(taskId, project);
    await page.goto(`/projects/${project}`);
    // The empty panel offers a chip for the page, never adds it by itself.
    await launcher(page).click();
    await expect(panel(page).getByTestId("chips")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Ask about this project" }).click();
    await expect(panel(page).getByTestId("chips")).toContainText("Launch plan");
    await panel(page).getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "More actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Ask about this" }).click();
    await expect(panel(page).getByTestId("chips")).toContainText("Launch plan");
  });

  test("dropping a note from the list on the button adds a chip, sends nothing, and answers from it", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, {
      title: "Budget review",
      text: "Budget review: hosting costs rose.",
    });
    await insertNote(user.id, { title: "Budget other", text: "Budget other mentions a secret." });
    await page.goto("/notes");
    const row = page.getByRole("link", { name: /Budget review/ });
    await expect(row).toBeVisible();
    await row.dragTo(launcher(page));
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByTestId("chips")).toContainText("Budget review");
    // Nothing was sent by the drop.
    await expect(panel(page).getByTestId("user-message")).toHaveCount(0);
    await ask(page, "budget costs");
    await expect(panel(page).getByTestId("assistant-message")).toContainText("Budget review");
    await expect(panel(page)).not.toContainText("secret");
    // The list is unchanged: the drag moved nothing.
    await expect(page.getByRole("link", { name: /Budget other/ })).toBeVisible();
  });

  test("a sixth item is refused, and a repeat is ignored", async ({ page }) => {
    const { user } = await newUser(page);
    for (let i = 1; i <= 6; i += 1)
      await insertNote(user.id, { title: `Item ${i}`, text: `text ${i}` });
    await page.goto("/assistant");
    const chat = page.getByTestId("assistant-chat");
    for (let i = 1; i <= 5; i += 1) {
      await chat.getByRole("button", { name: "Add item to ask about" }).click();
      await page.getByRole("option", { name: new RegExp(`Item ${i}`) }).click();
      await expect(chat.getByTestId("chips").getByRole("listitem")).toHaveCount(i);
    }
    await chat.getByRole("button", { name: "Add item to ask about" }).click();
    await page.getByRole("option", { name: /Item 6/ }).click();
    await expect(page.getByText(/up to 5 items/)).toBeVisible();
    await expect(chat.getByTestId("chips").getByRole("listitem")).toHaveCount(5);
    await chat.getByRole("button", { name: "Search everything instead" }).click();
    await expect(chat.getByTestId("chips")).toHaveCount(0);
  });

  test("a Board card dropped on the button is asked about and not moved", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Ship the banner", status: "PLANNED" });
    await page.goto("/tasks");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Board by status", exact: true }).last().click();
    const card = page.locator("[data-item-id]").filter({ hasText: "Ship the banner" });
    await expect(card).toBeVisible();

    const from = (await card.boundingBox())!;
    const target = (await launcher(page).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, {
      steps: 4,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByTestId("chips")).toContainText("Ship the banner");
    expect((await taskByTitle(user.id, "Ship the banner"))[0]?.status).toBe("PLANNED");
    void taskId;
    expect(await auditRows(user.id)).toEqual([]);
  });
});
