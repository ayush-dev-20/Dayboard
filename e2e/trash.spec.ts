import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  inboxItemsOf,
  insertInboxItem,
  insertNote,
  insertProject,
  insertTask,
  insertTodo,
  noteByTitle,
  projectByName,
  rowExists,
  taskByTitle,
  taskDeletedAt,
  todoByTitle,
  trashRow,
} from "./db";
import { newDevice, signUp, taskRow } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const rowFor = (page: Page, title: string) =>
  page.locator("[data-trash-id]").filter({ hasText: title });

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Trash", () => {
  test("lists one of each type, restores a task with its subtasks, and deletes a note permanently", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const parent = await insertTask(user.id, { title: "Parent task" });
    const sub = await insertTask(user.id, { title: "Child task", parentTaskId: parent });
    const todo = await insertTodo(user.id, { title: "A todo" });
    const note = await insertNote(user.id, { title: "A note", text: "x", emoji: "💡" });
    const project = await insertProject(user.id, { name: "A project" });
    const inbox = await insertInboxItem(user.id, "An inbox thought\nwith a second line");

    // Delete the task and its subtask the way the app does (from the Tasks page), the rest directly.
    await page.goto("/tasks");
    await page.getByRole("button", { name: "More actions for Parent task" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    expect(await taskDeletedAt(sub)).not.toBeNull();
    for (const [table, id] of [
      ["todos", todo],
      ["notes", note],
      ["projects", project],
      ["inbox_items", inbox],
    ] as const) {
      await trashRow(table, id);
    }

    await page.goto("/trash");
    await expect(page.getByText("5 items")).toBeVisible();
    const expected: [string, string][] = [
      ["Task", "Parent task"],
      ["Todo", "A todo"],
      ["Note", "A note"],
      ["Project", "A project"],
      ["Inbox", "An inbox thought"],
    ];
    for (const [label, title] of expected) {
      await expect(rowFor(page, title)).toContainText(label);
    }
    // The subtask travels with its parent: it has no row of its own.
    await expect(rowFor(page, "Child task")).toHaveCount(0);
    await expect(rowFor(page, "A note")).toContainText("💡");
    await expect(page.getByText("Nothing is deleted automatically.")).toBeVisible();

    // Type tabs.
    const tabs = page.getByRole("navigation", { name: "Item type" });
    await tabs.getByRole("link", { name: "Notes", exact: true }).click();
    await expect(page).toHaveURL(/type=note/);
    await expect(rowFor(page, "A note")).toBeVisible();
    await expect(rowFor(page, "Parent task")).toHaveCount(0);
    await tabs.getByRole("link", { name: "All", exact: true }).click();

    // Restore the task: its subtask is back too.
    await rowFor(page, "Parent task")
      .getByRole("button", { name: /^Restore/ })
      .click();
    await expect(page.getByText("Restored.")).toBeVisible();
    await expect(rowFor(page, "Parent task")).toHaveCount(0);
    expect(await taskDeletedAt(parent)).toBeNull();
    expect(await taskDeletedAt(sub)).toBeNull();
    await page.goto("/tasks");
    await expect(taskRow(page, "Parent task")).toContainText("0/1");

    // Delete the note permanently: it asks first, and it is gone after a reload.
    await page.goto("/trash");
    await rowFor(page, "A note")
      .getByRole("button", { name: /^More actions/ })
      .click();
    await page.getByRole("menuitem", { name: "Delete permanently" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("This can’t be undone.");
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByText("Deleted permanently.")).toBeVisible();
    await page.reload();
    await expect(rowFor(page, "A note")).toHaveCount(0);
    expect(await rowExists("notes", note)).toBe(false);
    expect(await noteByTitle(user.id, "A note")).toBeNull();
  });

  test("restoring each kind brings it back to its own page", async ({ page }) => {
    const { user } = await newUser(page);
    const todo = await insertTodo(user.id, { title: "Restore todo" });
    const project = await insertProject(user.id, { name: "Restore project" });
    const inbox = await insertInboxItem(user.id, "Restore inbox");
    const note = await insertNote(user.id, { title: "Restore note", text: "x" });
    for (const [table, id] of [
      ["todos", todo],
      ["projects", project],
      ["inbox_items", inbox],
      ["notes", note],
    ] as const) {
      await trashRow(table, id);
    }
    await page.goto("/trash");
    for (const title of ["Restore todo", "Restore project", "Restore inbox", "Restore note"]) {
      await rowFor(page, title)
        .getByRole("button", { name: /^Restore/ })
        .click();
      await expect(rowFor(page, title)).toHaveCount(0);
    }
    await expect(page.getByText("Trash is empty.")).toBeVisible();
    expect((await todoByTitle(user.id, "Restore todo"))[0]?.deleted_at).toBeNull();
    expect((await projectByName(user.id, "Restore project"))?.deleted_at).toBeNull();
    expect((await inboxItemsOf(user.id))[0]?.deleted_at).toBeNull();
    expect((await noteByTitle(user.id, "Restore note"))?.deleted_at).toBeNull();
  });

  test("Empty trash asks first, says what will go, and removes it all", async ({ page }) => {
    const { user } = await newUser(page);
    const a = await insertTask(user.id, { title: "Gone task 1" });
    const b = await insertTask(user.id, { title: "Gone task 2" });
    const c = await insertTodo(user.id, { title: "Gone todo" });
    const d = await insertNote(user.id, { title: "Gone note", text: "x" });
    const keep = await insertTask(user.id, { title: "Keep me" });
    for (const [table, id] of [
      ["tasks", a],
      ["tasks", b],
      ["todos", c],
      ["notes", d],
    ] as const)
      await trashRow(table, id);

    await page.goto("/trash");
    await page.getByRole("button", { name: "Empty trash" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "4 items will be deleted permanently: 2 tasks, 1 todo and 1 note.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await rowExists("tasks", a)).toBe(true);

    await page.getByRole("button", { name: "Empty trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 4 items" }).click();
    await expect(page.getByText("Trash is empty.")).toBeVisible();
    for (const [table, id] of [
      ["tasks", a],
      ["tasks", b],
      ["todos", c],
      ["notes", d],
    ] as const)
      expect(await rowExists(table, id)).toBe(false);
    expect((await taskByTitle(user.id, "Keep me"))[0]?.id).toBe(keep);
  });

  test("an empty Trash explains itself, and a task whose project is still trashed restores as No project", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/trash");
    await expect(page.getByRole("heading", { name: "Trash is empty." })).toBeVisible();

    const project = await insertProject(user.id, { name: "Trashed project" });
    const task = await insertTask(user.id, { title: "In a trashed project" });
    const { setTaskProject } = await import("./db");
    await setTaskProject(task, project);
    await trashRow("tasks", task);
    await trashRow("projects", project);
    await page.goto("/trash");
    await rowFor(page, "In a trashed project")
      .getByRole("button", { name: /^Restore/ })
      .click();
    await expect(page.getByText("Restored.")).toBeVisible();
    await page.goto("/tasks");
    await expect(taskRow(page, "In a trashed project")).toBeVisible();
    await expect(taskRow(page, "In a trashed project")).not.toContainText("Trashed project");
  });

  test("another person's trash is invisible", async ({ browser, page }) => {
    const { user } = await newUser(page);
    const task = await insertTask(user.id, { title: "Alice trashed task" });
    await trashRow("tasks", task);
    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    await signUp(bobPage);
    await bobPage.goto("/trash");
    await expect(bobPage.getByText("Alice trashed task")).toHaveCount(0);
    await expect(bobPage.getByRole("heading", { name: "Trash is empty." })).toBeVisible();
    await context.close();
    expect(await taskDeletedAt(task)).not.toBeNull();
  });
});
