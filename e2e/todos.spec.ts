import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertTodo, todoByTitle } from "./db";
import { chipFor, signUp, today, todoRow } from "./helpers";

async function newUser(page: import("@playwright/test").Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

async function addTodo(page: import("@playwright/test").Page, title: string) {
  await page.getByLabel("Add todo", { exact: true }).fill(title);
  await page.keyboard.press("Enter");
  await expect(todoRow(page, title)).toBeVisible();
}

test.describe("todos", () => {
  test("create, edit with an emoji and a date, toggle, and delete with Undo", async ({ page }) => {
    const user = await newUser(page);
    await page.goto("/tasks?view=todos");
    await expect(page.getByText("No todos yet.")).toBeVisible();

    await addTodo(page, "Buy milk");
    await expect(page.getByText("1 open todo")).toBeVisible();
    await expect(page.getByLabel("Add todo", { exact: true })).toBeFocused();

    // A todo is light: no priority, subtasks, tags or description anywhere.
    await expect(page.getByText("Todos are quick checkboxes.")).toBeVisible();

    await todoRow(page, "Buy milk").getByRole("button", { name: "Buy milk", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title")).toHaveValue("Buy milk");
    await expect(dialog.getByText(/priority|subtask|description/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Todo emoji" }).click();
    await page
      .getByRole("group", { name: "Quick picks" })
      .getByRole("button", { name: "🛒" })
      .click();
    await dialog.getByLabel("Title").fill("Buy oat milk");
    await dialog.getByLabel("Due date (optional)").fill(today(1));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    const row = todoRow(page, "Buy oat milk");
    await expect(row).toContainText("🛒");
    await expect(row).toContainText(chipFor(1));
    expect((await todoByTitle(user.id, "Buy oat milk"))[0]).toMatchObject({
      emoji: "🛒",
      due_date: today(1),
    });

    // Toggle: round checkbox, stays in place while Undo is offered, then moves to Completed today.
    const box = row.getByRole("checkbox");
    await box.click();
    await expect(box).toBeChecked();
    await expect(page.getByText("Todo completed.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(box).not.toBeChecked();
    await expect
      .poll(async () => (await todoByTitle(user.id, "Buy oat milk"))[0]?.is_complete)
      .toBe(false);

    await box.click();
    await expect(page.getByText("Todo completed.")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByRole("region", { name: /^Completed today/ })).toContainText(
      "Buy oat milk",
    );
    await page.reload();
    await expect(page.getByRole("region", { name: /^Completed today/ })).toContainText(
      "Buy oat milk",
    );
    expect((await todoByTitle(user.id, "Buy oat milk"))[0]!.is_complete).toBe(true);

    // Delete with Undo.
    await page.getByRole("button", { name: "More actions for Buy oat milk" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(todoRow(page, "Buy oat milk")).toHaveCount(0);
    await expect
      .poll(async () => (await todoByTitle(user.id, "Buy oat milk"))[0]?.deleted_at ?? null)
      .not.toBeNull();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(todoRow(page, "Buy oat milk")).toBeVisible();
    await expect
      .poll(async () => (await todoByTitle(user.id, "Buy oat milk"))[0]?.deleted_at ?? null)
      .toBeNull();
  });

  test("todos can be reordered from the menu and with Alt+Arrow, and the order sticks", async ({
    page,
  }) => {
    const user = await newUser(page);
    await insertTodo(user.id, { title: "One" });
    await insertTodo(user.id, { title: "Two" });
    await insertTodo(user.id, { title: "Three" });
    await page.goto("/tasks?view=todos");

    const order = async () =>
      (await page.locator("[data-todo-id] [data-row-focus]").allTextContents()).join(",");
    expect(await order()).toBe("One,Two,Three");

    await page.getByRole("button", { name: "More actions for Three" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(order).toBe("One,Three,Two");

    await todoRow(page, "One").getByRole("button", { name: "One", exact: true }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(order).toBe("Three,One,Two");

    await page.reload();
    expect(await order()).toBe("Three,One,Two");
  });

  test("an empty title is refused", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks?view=todos");
    await page.getByLabel("Add todo", { exact: true }).fill("   ");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-todo-id]")).toHaveCount(0);
  });

  test("someone else's todos are not shown and cannot be reached", async ({ browser, page }) => {
    const owner = await newUser(page);
    await insertTodo(owner.id, { title: "Alice's todo" });

    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.8.8.8" } });
    const otherPage = await other.newPage();
    await signUp(otherPage);
    await otherPage.goto("/tasks?view=todos");
    await expect(otherPage.getByText("Alice's todo")).toHaveCount(0);
    await expect(otherPage.getByText("No todos yet.")).toBeVisible();
    await other.close();
  });
});
