import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  focusTaskOf,
  insertInboxItem,
  insertNote,
  insertTask,
  insertTodo,
  taskByTitle,
} from "./db";
import { signUp, taskRow, todoRow, today } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const section = (page: Page, name: string | RegExp) => page.getByRole("region", { name });

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Today", () => {
  test("shows the greeting, and each kind of item in its own section", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Late invoice", dueDate: today(-3), priority: "HIGH" });
    await insertTask(user.id, { title: "Due today", dueDate: today() });
    await insertTask(user.id, { title: "Dentist", dueDate: today(), dueTime: "23:30" });
    await insertTask(user.id, { title: "Next week", dueDate: today(7) });
    await insertTask(user.id, { title: "Plan the launch", priority: "HIGH" });
    await insertTask(user.id, { title: "Low priority idea", priority: "LOW" });
    await insertTask(user.id, { title: "Finished earlier", status: "DONE", dueDate: today() });
    await insertTodo(user.id, { title: "Buy oat milk" });
    await insertTodo(user.id, { title: "Call mum", dueDate: today() });
    await insertTodo(user.id, { title: "Far future", dueDate: today(20) });
    await insertNote(user.id, { title: "Meeting notes", text: "agenda" });

    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Good (morning|afternoon|evening), Test/,
    );

    await expect(
      section(page, /^Overdue/).getByRole("button", { name: "Late invoice", exact: true }),
    ).toBeVisible();
    const todaySection = section(page, /^Today/);
    await expect(
      todaySection.getByRole("button", { name: "Due today", exact: true }),
    ).toBeVisible();
    // A task with a time later today is listed after the untimed ones, under its own small heading.
    await expect(todaySection.getByText("Scheduled later today")).toBeVisible();
    await expect(todaySection.getByRole("button", { name: "Dentist", exact: true })).toBeVisible();
    const order = await todaySection.locator("[data-task-id] [data-row-focus]").allTextContents();
    expect(order).toEqual(["Due today", "Dentist"]);

    const todos = section(page, /^Todos/);
    await expect(todos.getByRole("button", { name: "Call mum", exact: true })).toBeVisible();
    await expect(todos.getByRole("button", { name: "Buy oat milk", exact: true })).toBeVisible();
    await expect(todos.getByRole("button", { name: "Far future", exact: true })).toHaveCount(0);
    const todoOrder = await todos.locator("[data-todo-id] [data-row-focus]").allTextContents();
    expect(todoOrder).toEqual(["Call mum", "Buy oat milk"]); // dated first

    const planning = section(page, /^Needs planning/);
    await expect(
      planning.getByRole("button", { name: "Plan the launch", exact: true }),
    ).toBeVisible();
    await expect(
      planning.getByRole("button", { name: "Low priority idea", exact: true }),
    ).toHaveCount(0);

    await expect(
      section(page, /^Recently updated notes/).getByRole("link", { name: /Meeting notes/ }),
    ).toBeVisible();
    // Completed today is collapsed.
    await expect(page.getByRole("button", { name: "Finished earlier", exact: true })).toBeHidden();
    await page.locator("summary", { hasText: "Completed today" }).click();
    await expect(page.getByRole("button", { name: "Finished earlier", exact: true })).toBeVisible();
  });

  test("tasks completed today appear under Completed today", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Do this now", dueDate: today() });
    await page.goto("/today");
    await taskRow(page, "Do this now").getByRole("checkbox").click();
    await expect(page.getByText("Task completed.")).toBeVisible();
    await expect(page.getByText("Task completed.")).toHaveCount(0, { timeout: 12_000 });
    await expect(section(page, /^Today/)).toHaveCount(0); // nothing left due today
    await page.locator("summary", { hasText: "Completed today" }).click();
    await expect(page.getByRole("button", { name: "Do this now", exact: true })).toBeVisible();
    await expect(page.getByText("Completed today")).toContainText("1");
  });

  test("completing from Today behaves like the Tasks page: instant, with Undo", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Undo me", dueDate: today() });
    await page.goto("/today");
    const row = taskRow(page, "Undo me");
    await row.getByRole("checkbox").click();
    await expect(row.getByRole("checkbox")).toBeChecked();
    await page
      .getByRole("region", { name: /Notifications/ })
      .getByRole("button", { name: "Undo" })
      .first()
      .click();
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Undo me"))[0]?.status)
      .toBe("PLANNED");
  });

  test("overdue shows ten, with a link to see them all", async ({ page }) => {
    const { user } = await newUser(page);
    for (let i = 0; i < 12; i++)
      await insertTask(user.id, { title: `Overdue ${i}`, dueDate: today(-1) });
    await page.goto("/today");
    await expect(section(page, /^Overdue/).locator("[data-task-id]")).toHaveCount(10);
    await expect(section(page, /^Overdue/)).toContainText("12");
    await page.getByRole("link", { name: "Show all 12" }).click();
    await expect(page).toHaveURL(/\/tasks\?due=overdue/);
    await expect(page.locator("[data-task-id]")).toHaveCount(12);
  });

  test("choose a focus, see it, complete it, and the focus clears", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertTask(user.id, { title: "Finish the report", dueDate: today() });
    await insertTask(user.id, { title: "Something else" });
    await page.goto("/today");
    await expect(page.getByText("Pick one thing to focus on.")).toBeVisible();

    await page.getByRole("button", { name: "Choose a task" }).click();
    await page.getByLabel("Search your open tasks").fill("report");
    await page.getByRole("dialog").getByRole("button", { name: "Finish the report" }).click();
    const focus = page.getByRole("region", { name: "Focus" });
    await expect(focus.getByRole("link", { name: "Finish the report" })).toBeVisible();
    await expect.poll(async () => focusTaskOf(user.id)).toBe(id);
    await page.reload();
    await expect(focus.getByRole("link", { name: "Finish the report" })).toBeVisible();

    // Change, then clear.
    await focus.getByRole("button", { name: "Change focus" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Something else" }).click();
    await expect(focus.getByRole("link", { name: "Something else" })).toBeVisible();
    await focus.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("Pick one thing to focus on.")).toBeVisible();
    await expect.poll(async () => focusTaskOf(user.id)).toBeNull();

    // Complete the focus: once the Undo toast is gone the focus is cleared by itself.
    await focus.getByRole("button", { name: "Choose a task" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finish the report" }).click();
    await focus.getByRole("checkbox", { name: "Complete Finish the report" }).click();
    await expect(page.getByText("Task completed.")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByText("Pick one thing to focus on.")).toBeVisible();
    await expect.poll(async () => focusTaskOf(user.id)).toBeNull();
  });

  test("a focus task that is trashed elsewhere is dropped", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertTask(user.id, { title: "Soon gone" });
    await page.goto("/today");
    await page.getByRole("button", { name: "Choose a task" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Soon gone" }).click();
    await expect.poll(async () => focusTaskOf(user.id)).toBe(id);
    const { trashRow } = await import("./db");
    await trashRow("tasks", id);
    await page.reload();
    await expect(page.getByText("Pick one thing to focus on.")).toBeVisible();
    await expect.poll(async () => focusTaskOf(user.id)).toBeNull();
  });

  test("an empty day says so and offers the next step", async ({ page }) => {
    await newUser(page);
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Your day is clear." })).toBeVisible();
    await expect(page.getByText("Capture a task or start a note.")).toBeVisible();
    await page.getByRole("link", { name: "New note" }).click();
    await expect(page).toHaveURL(/\/notes\/new/);
    await page.goBack();
    await page.getByRole("link", { name: "New task" }).click();
    await expect(page).toHaveURL(/\/tasks\?focus=add/);
    await expect(page.getByLabel("Add task", { exact: true })).toBeFocused();
  });

  test("the sidebar shows how many tasks are due and how many inbox items are open", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "a", dueDate: today(-2) });
    await insertTask(user.id, { title: "b", dueDate: today() });
    await insertTask(user.id, { title: "c", dueDate: today(4) });
    await insertInboxItem(user.id, "one");
    await insertInboxItem(user.id, "two");
    await insertInboxItem(user.id, "three");
    await page.goto("/tasks");
    const nav = page.getByRole("complementary").getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: /^Today/ })).toContainText("2");
    await expect(nav.getByRole("link", { name: /^Inbox/ })).toContainText("3");
  });

  test("only the person's own items are shown", async ({ browser, page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Alice overdue secret", dueDate: today(-1) });
    const { newDevice } = await import("./helpers");
    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    await signUp(bobPage);
    await bobPage.goto("/today");
    await expect(bobPage.getByText("Alice overdue secret")).toHaveCount(0);
    await expect(bobPage.getByRole("heading", { name: "Your day is clear." })).toBeVisible();
    await context.close();
    expect(todoRow).toBeTruthy();
  });
});
