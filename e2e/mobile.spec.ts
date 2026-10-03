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
  trashRow,
} from "./db";
import { signUp, taskRow, today, animationsDone } from "./helpers";

async function hasHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe("phone", () => {
  test("auth screens fit a 360px phone and use 16px inputs so iOS doesn't zoom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/verify-email",
      "/magic-link-sent",
    ]) {
      await page.goto(path);
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }

    await page.goto("/sign-in");
    const fontSize = await page.getByLabel("Email").evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("16px");

    // Tap targets are at least 44px tall.
    for (const target of [
      page.getByLabel("Email"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Sign in", exact: true }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the bottom navigation replaces the sidebar, and More leads to the rest", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signUp(page);

    await expect(page.getByRole("complementary")).toBeHidden();
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const label of ["Today", "Tasks", "Notes", "Inbox", "More"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks/);

    await nav.getByRole("link", { name: "More" }).click();
    await expect(page).toHaveURL(/\/more/);
    for (const label of ["Projects", "Search", "Trash", "Settings"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account/);
    // Settings lives under More, so More stays highlighted.
    await expect(nav.getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  test("the bottom nav never covers the end of a page", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await signUp(page);
    await page.goto("/settings/account");

    const lastRow = page.getByRole("button", { name: "Delete account" });
    await lastRow.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const button = await lastRow.boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(nav!.y);
  });

  test("signed-in pages fit a 360px phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signUp(page);

    for (const path of [
      "/today",
      "/inbox",
      "/tasks",
      "/notes",
      "/projects",
      "/search",
      "/trash",
      "/more",
      "/settings/account",
      "/settings/appearance",
      "/settings/productivity",
      "/settings/ai",
    ]) {
      await page.goto(path);
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }
  });

  test("the Appearance tab is shortened to Look on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signUp(page);
    await page.goto("/settings/account");
    const tabs = page.getByRole("navigation", { name: "Settings sections" });
    await expect(tabs.getByRole("link", { name: "Look" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Appearance" })).toHaveCount(0);
  });

  test("dialogs fit the screen and the delete confirmation works by touch", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await signUp(page);
    await page.goto("/settings/account");

    await page.getByRole("button", { name: "Delete account" }).tap();
    const dialog = page.getByRole("dialog");
    // Measure once the dialog has finished scaling in (feature 07 motion).
    await animationsDone(dialog);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(dialog).toHaveCount(0);
  });

  test("tapping a task opens the full-page detail, and Back returns to the list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    const id = await insertTask(user.id, { title: "Phone task" });
    await page.goto("/tasks");

    await taskRow(page, "Phone task")
      .getByRole("button", { name: "Phone task", exact: true })
      .tap();
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
    await expect(page.getByLabel("Task title")).toHaveValue("Phone task");
    await expect(page.getByRole("complementary", { name: "Task detail" })).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // The sheet URL is turned into the page on a phone.
    await page.goto(`/tasks?task=${id}`);
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));

    await page.getByRole("main").getByRole("link", { name: "Tasks", exact: true }).tap();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("the tasks list has 44px tap targets and the emoji picker opens as a bottom sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    const id = await insertTask(user.id, { title: "Tap me" });
    await page.goto("/tasks");

    for (const target of [
      taskRow(page, "Tap me").getByRole("checkbox"),
      page.getByRole("button", { name: "More actions for Tap me" }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    await page.goto(`/tasks/${id}`);
    await page.getByRole("button", { name: "Task emoji" }).tap();
    const sheet = page.getByRole("dialog");
    const box = await sheet.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(790); // anchored to the bottom edge
    await sheet
      .getByRole("group", { name: "Quick picks" })
      .getByRole("button", { name: "🎯" })
      .tap();
    await expect(page.getByRole("button", { name: "Task emoji" })).toContainText("🎯");
  });

  test("notes: the list and editor fit a phone; the editor takes the whole screen with its toolbar at the bottom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    const project = await insertProject(user.id, { name: "Acme" });
    const noteId = await insertNote(user.id, {
      title: "Phone note",
      text: "hello there",
      projectId: project,
    });
    for (const path of [
      "/notes",
      `/notes/${noteId}`,
      "/projects",
      `/projects/${project}`,
      "/settings/tags",
    ]) {
      await page.goto(path);
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }

    await page.goto("/notes");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.getByRole("link", { name: /Phone note/ }).tap();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));

    // No bottom navigation or top bar here: the page is the editor.
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(toolbar).toBeVisible();
    const box = await toolbar.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(740 - 4); // pinned to the bottom edge
    for (const target of [
      page.getByRole("button", { name: "Bold" }),
      page.getByRole("button", { name: "More actions" }),
    ]) {
      const b = await target.boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.width).toBeGreaterThanOrEqual(44);
    }

    // Typing and formatting by touch saves.
    await page.getByRole("textbox", { name: "Note content" }).tap();
    await page.keyboard.press("End");
    await page.keyboard.type(" and more");
    await page.getByRole("button", { name: "Bold" }).tap();
    await page.keyboard.type(" bold");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Phone note"))?.content_text)
      .toBe("hello there and more bold");

    await page.getByRole("link", { name: "Back to notes" }).tap();
    await expect(page).toHaveURL(/\/notes$/);
  });

  test("a new note on a phone is created by typing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    await page.goto("/notes");
    await page.getByRole("link", { name: "New note" }).first().tap();
    await expect(page).toHaveURL(/\/notes\/new$/);
    await page.getByLabel("Note title").fill("From my phone");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect.poll(async () => (await noteByTitle(user.id, "From my phone"))?.id).toBeTruthy();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  });

  test("projects: the list and detail work by touch", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    const id = await insertProject(user.id, { name: "Phone project" });
    await insertTask(user.id, { title: "A task here" });
    await page.goto("/projects");
    await page.getByRole("link", { name: /Phone project/ }).tap();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
    await page.getByRole("button", { name: "Add task" }).tap();
    await page.getByLabel("New task in this project").fill("Added by touch");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Added by touch", exact: true })).toBeVisible();
    for (const name of ["Add task", "Add todo", "Add note"]) {
      const b = await page
        .getByRole(name === "Add note" ? "link" : "button", { name })
        .boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("Today, Inbox, Search and Trash fit a 360px phone without sideways scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    await insertTask(user.id, {
      title: "A fairly long task title that must truncate nicely on a phone",
      dueDate: today(-1),
    });
    await insertTodo(user.id, { title: "A todo" });
    await insertNote(user.id, {
      title: "A note with a long name that should not push the page wider",
      text: "body",
    });
    await insertInboxItem(user.id, "A long captured thought ".repeat(12));
    const trashed = await insertTask(user.id, {
      title: "Trashed with a very very long title that keeps going",
    });
    await trashRow("tasks", trashed);
    for (const path of ["/today", "/inbox", "/search?q=note", "/search", "/trash"]) {
      await page.goto(path);
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }
  });

  test("the command menu is a full-screen sheet on a phone, and capture works by touch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    await insertNote(user.id, { title: "Phone findable note", text: "x" });
    await page.goto("/today");

    await page.getByRole("button", { name: "Search", exact: true }).tap();
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box!.width).toBe(390);
    expect(box!.height).toBeGreaterThanOrEqual(790);

    await page.keyboard.type("findable");
    await dialog.getByRole("option", { name: /Phone findable note/ }).tap();
    await expect(page).toHaveURL(/\/notes\//);

    await page.goto("/today");
    await page.getByLabel("Capture to Inbox").fill("Captured on a phone");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Saved to Inbox.")).toBeVisible();
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).map((i) => i.text))
      .toEqual(["Captured on a phone"]);
  });

  test("converting an inbox item works on a phone: the dialog fits and its controls are tappable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    const account = await signUp(page);
    const user = (await findUser(account.email))!;
    await insertInboxItem(user.id, "Phone thought\nwith more detail");
    await page.goto("/inbox");

    await page.getByRole("button", { name: "Convert" }).tap();
    await page.getByRole("menuitem", { name: "Todo", exact: true }).tap();
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    for (const name of ["Cancel", "Create todo"]) {
      // Polled: the dialog scales in from 0.98 (feature 07 motion); the settled size is what counts.
      await expect
        .poll(async () => (await dialog.getByRole("button", { name }).boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Create todo" }).tap();
    await expect(page.getByText("Converted to a todo.")).toBeVisible();
  });
});
