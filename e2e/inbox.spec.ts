import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  inboxItemsOf,
  insertInboxItem,
  insertProject,
  linkedNoteIds,
  noteByTitle,
  projectByName,
  taskByTitle,
  todoByTitle,
} from "./db";
import { signUp } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const sidebar = (page: Page) =>
  page.getByRole("complementary").getByRole("navigation", { name: "Primary" });
const toastUndo = (page: Page) =>
  page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Undo" })
    .first();

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("capture", () => {
  test("Cmd/Ctrl+K, type, Cmd/Ctrl+Enter saves to the Inbox, then convert to a task and a note", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await page.goto("/today");

    const started = Date.now();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.type("Check production logs tomorrow and tell Rahul once it is fixed");
    await expect(
      page.getByText(
        "Capture “Check production logs tomorrow and tell Rahul once it is fixed” to Inbox",
      ),
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText("Saved to Inbox.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Capture is quick: menu open → typed → saved well inside the 10 second target.
    expect(Date.now() - started).toBeLessThan(10_000);

    await expect.poll(async () => (await inboxItemsOf(user.id)).length).toBe(1);
    await expect(sidebar(page).getByRole("link", { name: /Inbox/ })).toContainText("1");

    await page.goto("/inbox");
    await expect(
      page.getByText("Check production logs tomorrow and tell Rahul once it is fixed"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Task and note" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: "Task + note", selected: true })).toBeVisible();
    await expect(dialog.getByLabel("Title")).toHaveValue(
      "Check production logs tomorrow and tell Rahul once it is fixed",
    );
    await dialog.getByLabel("Title").fill("Check production logs");
    await dialog.getByRole("button", { name: "Create task and note" }).click();
    await expect(page.getByText("Converted to a task and a note.")).toBeVisible();

    const task = (await taskByTitle(user.id, "Check production logs"))[0]!;
    const note = (await noteByTitle(user.id, "Check production logs"))!;
    expect(task).toBeTruthy();
    expect(note.content_text).toContain("Check production logs tomorrow and tell Rahul");
    expect(await linkedNoteIds(task.id)).toEqual([note.id]);

    // The item left the open list and sits under "Recently converted" with links to what it became.
    await expect(page.getByText("Your inbox is empty.")).toBeVisible();
    await page.locator("summary", { hasText: "Recently converted" }).click();
    await expect(page.getByText("Converted to a task and a note:")).toBeVisible();
    await expect(page.getByRole("link", { name: "Check production logs" })).toHaveCount(2);
    expect((await inboxItemsOf(user.id))[0]).toMatchObject({ status: "CONVERTED" });
    await expect(sidebar(page).getByRole("link", { name: /Inbox/ })).not.toContainText("1");
  });

  test("the C key opens quick capture from anywhere; Esc closes without saving", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await page.keyboard.press("c");
    await expect(page.getByLabel("What do you want to capture?")).toBeVisible();
    await page.keyboard.type("Remember the milk");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await inboxItemsOf(user.id)).toHaveLength(0);

    await page.keyboard.press("c");
    await page.keyboard.type("Remember the milk");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByText("Saved to Inbox.")).toBeVisible();
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).map((i) => i.text))
      .toEqual(["Remember the milk"]);
  });

  test("C is ignored while typing, and the top bar Quick capture button works", async ({
    page,
  }) => {
    await newUser(page);
    await page.goto("/tasks");
    await page.getByLabel("Add task", { exact: true }).fill("a ");
    await page.keyboard.press("c");
    await expect(page.getByLabel("Add task", { exact: true })).toHaveValue("a c");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Quick capture" }).first().click();
    await expect(page.getByLabel("What do you want to capture?")).toBeVisible();
  });

  test("a failed save keeps the text and offers Retry", async ({ page, context }) => {
    const { user } = await newUser(page);
    await page.goto("/today");
    await page.keyboard.press("c");
    await page.keyboard.type("Do not lose this thought");
    await context.setOffline(true);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText("Could not save. Your text is still here.")).toBeVisible();
    await expect(page.getByLabel("What do you want to capture?")).toHaveValue(
      "Do not lose this thought",
    );

    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Saved to Inbox.")).toBeVisible();
    await expect.poll(async () => (await inboxItemsOf(user.id)).length).toBe(1);
  });

  test("the Inbox page and the Today page have their own capture boxes", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/inbox");
    await expect(page.getByText("Your inbox is empty.")).toBeVisible();
    await page.getByLabel("Capture a thought").fill("From the inbox page");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText("From the inbox page")).toBeVisible();
    await expect(page.getByLabel("Capture a thought")).toHaveValue("");

    await page.goto("/today");
    await page.getByLabel("Capture to Inbox").fill("From today");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Saved to Inbox.")).toBeVisible();
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).map((i) => i.text))
      .toEqual(["From the inbox page", "From today"]);
  });
});

test.describe("converting", () => {
  test("to a todo, a note and a project idea", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertInboxItem(user.id, "Buy oat milk");
    await insertInboxItem(user.id, "Standing desks\nUnder 30k, check the reviews first");
    await insertInboxItem(user.id, "Weekly review template\nfor the side project");
    await page.goto("/inbox");

    // Todo
    const todoRow = page.locator("[data-inbox-id]").filter({ hasText: "Buy oat milk" });
    await todoRow.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Todo", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create todo" }).click();
    await expect(page.getByText("Converted to a todo.")).toBeVisible();
    await expect.poll(async () => (await todoByTitle(user.id, "Buy oat milk")).length).toBe(1);

    // Note: the title is the first line and the whole text is the body.
    const noteRow = page.locator("[data-inbox-id]").filter({ hasText: "Standing desks" });
    await noteRow.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Note", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("Standing desks");
    await page.getByRole("dialog").getByRole("button", { name: "Create note" }).click();
    await expect(page.getByText("Converted to a note.")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Standing desks"))?.content_text)
      .toBe("Standing desks\nUnder 30k, check the reviews first");

    // Project idea: on hold, with the rest as its description.
    const projectRow = page
      .locator("[data-inbox-id]")
      .filter({ hasText: "Weekly review template" });
    await projectRow.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Project idea" }).click();
    await expect(page.getByRole("dialog").getByLabel("Name")).toHaveValue("Weekly review template");
    await page.getByRole("dialog").getByRole("button", { name: "Create project idea" }).click();
    await expect(page.getByText("Converted to a project idea.")).toBeVisible();
    await expect
      .poll(async () => (await projectByName(user.id, "Weekly review template"))?.status)
      .toBe("ON_HOLD");
    expect((await projectByName(user.id, "Weekly review template"))?.description).toBe(
      "for the side project",
    );

    await expect(page.getByText("Your inbox is empty.")).toBeVisible();
    await page.locator("summary", { hasText: "Recently converted" }).click();
    await expect(
      page.locator("details li", { hasText: "Converted to a project idea" }),
    ).toContainText("Weekly review template");
  });

  test("a task with a project and a date, or kept as an Inbox task", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    await insertInboxItem(user.id, "Prepare call notes");
    await insertInboxItem(user.id, "Maybe look into this");
    await page.goto("/inbox");

    const first = page.locator("[data-inbox-id]").filter({ hasText: "Prepare call notes" });
    await first.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Task", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("button", { name: "Acme" }).click();
    await dialog.getByLabel("Due date").fill("2026-12-24");
    await dialog.getByLabel("Description").fill("Bring the agenda");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Converted to a task.")).toBeVisible();
    const [made] = await taskByTitle(user.id, "Prepare call notes");
    expect(made).toMatchObject({ status: "PLANNED", due_date: "2026-12-24" });
    expect(made!.description_text).toBe("Bring the agenda");
    const { taskProject } = await import("./db");
    expect(await taskProject(made!.id)).toBe(acme);

    const second = page.locator("[data-inbox-id]").filter({ hasText: "Maybe look into this" });
    await second.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Task", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Decide later (keep as Inbox task)").check();
    await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Maybe look into this"))[0]?.status)
      .toBe("INBOX");
  });

  test("the dialog refuses an empty title and Cancel creates nothing", async ({ page }) => {
    const { user } = await newUser(page);
    await insertInboxItem(user.id, "Something");
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Convert" }).click();
    await page.getByRole("menuitem", { name: "Todo", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("   ");
    await dialog.getByRole("button", { name: "Create todo" }).click();
    await expect(dialog.getByText("Enter a title.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await inboxItemsOf(user.id))[0]).toMatchObject({ status: "OPEN" });
    expect(await todoByTitle(user.id, "Something")).toHaveLength(0);
  });

  test("archive and delete, each with Undo, and archived items can be moved back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertInboxItem(user.id, "Archive me");
    await insertInboxItem(user.id, "Delete me");
    await page.goto("/inbox");

    await page
      .locator("[data-inbox-id]")
      .filter({ hasText: "Archive me" })
      .getByRole("button", { name: "Archive" })
      .click();
    await expect(page.getByText("Archived.")).toBeVisible();
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).find((i) => i.text === "Archive me")?.status)
      .toBe("ARCHIVED");
    await toastUndo(page).dispatchEvent("click");
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).find((i) => i.text === "Archive me")?.status)
      .toBe("OPEN");

    await page
      .locator("[data-inbox-id]")
      .filter({ hasText: "Delete me" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(page.getByText("Delete me")).toHaveCount(0);
    await toastUndo(page).dispatchEvent("click");
    await expect(page.getByText("Delete me")).toBeVisible();
    expect(
      (await inboxItemsOf(user.id)).find((i) => i.text === "Delete me")?.deleted_at,
    ).toBeNull();

    await page
      .locator("[data-inbox-id]")
      .filter({ hasText: "Archive me" })
      .getByRole("button", { name: "Archive" })
      .click();
    await page.locator("summary", { hasText: "Archived" }).click();
    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect
      .poll(async () => (await inboxItemsOf(user.id)).find((i) => i.text === "Archive me")?.status)
      .toBe("OPEN");
  });

  test("someone else's inbox is never shown", async ({ browser, page }) => {
    const { user: alice } = await newUser(page);
    await insertInboxItem(alice.id, "Alice private thought");
    const { newDevice } = await import("./helpers");
    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    await signUp(bobPage);
    await bobPage.goto("/inbox");
    await expect(bobPage.getByText("Alice private thought")).toHaveCount(0);
    await expect(bobPage.getByText("Your inbox is empty.")).toBeVisible();
    await context.close();
  });
});
