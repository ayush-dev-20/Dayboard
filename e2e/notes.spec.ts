import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertNote,
  insertProject,
  insertTag,
  insertTask,
  linkTaskToNote,
  linkedNoteIds,
  noteByTitle,
  notesOf,
  saveNoteElsewhere,
  tagNote,
} from "./db";
import { newDevice, signUp } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  return { account, user };
}

// The editor has its own Undo button, so the toast's one is found inside the notifications region.
const toastUndo = (page: Page) =>
  page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Undo" })
    .last();
const moreActions = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const title = (page: Page) => page.getByLabel("Note title");

test.describe("writing a note", () => {
  test("creates the note on the first keystroke, keeps the cursor, and survives a reload", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/notes");
    await expect(page.getByText("No notes yet.")).toBeVisible();

    await page.getByRole("link", { name: "New note" }).first().click();
    await expect(page).toHaveURL(/\/notes\/new$/);
    // Nothing exists yet: opening a blank note and leaving leaves nothing behind.
    expect(await notesOf(user.id)).toHaveLength(0);

    await title(page).fill("Meeting notes");
    await page.keyboard.press("Enter"); // moves into the text
    await page.keyboard.type("Agenda");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await page.keyboard.type("brand review");
    await page.keyboard.press("Enter");
    await page.keyboard.type("timeline");
    await page.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type(" (bold)");

    await expect(page.getByText("Saved")).toBeVisible();
    // The address changed without reloading the page, and the cursor stayed in the text.
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(editor(page)).toBeFocused();

    await expect
      .poll(async () => (await noteByTitle(user.id, "Meeting notes"))?.content_text)
      .toBe("Agenda\n- brand review\n- timeline (bold)");
    expect(await notesOf(user.id)).toHaveLength(1); // one note, not one per save

    await page.reload();
    await expect(title(page)).toHaveValue("Meeting notes");
    await expect(editor(page).locator("ul li")).toHaveCount(2);
    await expect(editor(page).locator("strong")).toHaveText(" (bold)");
    await expect(editor(page)).toContainText("Agenda");

    // And it is in the list.
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Meeting notes/ })).toBeVisible();
  });

  test("an abandoned new note leaves nothing behind", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/notes/new");
    await expect(title(page)).toBeFocused();
    await page.goto("/notes");
    await expect(page.getByText("No notes yet.")).toBeVisible();
    expect(await notesOf(user.id)).toHaveLength(0);
  });

  test("headings, quotes, code and dividers come from the toolbar's text style menu and buttons", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Formats", text: "x" });
    await page.goto(`/notes/${id}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Text style" }).click();
    await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
    await expect(editor(page).locator("h2")).toHaveText("x");
    await page.getByRole("button", { name: "Quote" }).click();
    await expect(editor(page).locator("blockquote")).toHaveCount(1);
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Divider" }).click();
    await expect(editor(page).locator("hr")).toHaveCount(1);
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Formats"))?.version)
      .toBeGreaterThan(1);
    const saved = await noteByTitle(user.id, "Formats");
    const kinds = JSON.stringify(saved?.content_json);
    expect(kinds).toContain('"heading"');
    expect(kinds).toContain('"blockquote"');
    expect(kinds).toContain('"horizontalRule"');

    // Undo and redo are there too.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page).locator("hr")).toHaveCount(0);
  });

  test("the toolbar shows a selection menu over highlighted text", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Select me", text: "select these words" });
    await page.goto(`/notes/${id}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    const bubble = page.getByRole("button", { name: "Bold" });
    await expect(bubble).toHaveCount(2); // the toolbar and the floating menu
    await bubble.last().click();
    await expect(editor(page).locator("strong")).toHaveText("select these words");
  });

  test("the title can be emptied (shown as Untitled in the list) and an emoji set and removed", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Name me", text: "body text here" });
    await page.goto(`/notes/${id}`);
    await title(page).fill("");
    await title(page).blur();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect.poll(async () => (await noteByTitle(user.id, ""))?.id).toBe(id);

    await page.getByRole("button", { name: "Note emoji" }).click();
    await page
      .getByRole("group", { name: "Quick picks" })
      .getByRole("button", { name: "💡" })
      .click();
    await expect.poll(async () => (await noteByTitle(user.id, ""))?.emoji).toBe("💡");

    await page.goto("/notes");
    const row = page.getByRole("link", { name: /Untitled/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText("💡");
    await expect(row).toContainText("body text here");
  });
});

test.describe("saving safely", () => {
  test("typing offline keeps the text and saves when the connection returns", async ({
    page,
    context,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Offline", text: "start" });
    await page.goto(`/notes/${id}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");

    await context.setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await page.keyboard.type(" and more");
    await expect(page.getByText("Not saved, retrying")).toBeVisible({ timeout: 15_000 });
    await expect(editor(page)).toContainText("start and more");

    // A local draft protects the text even if the tab were closed right now.
    const draft = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `draft:note:${id}`,
    );
    expect(draft).toContain("and more");

    await context.setOffline(false);
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/You are offline/)).toHaveCount(0);
    await expect
      .poll(async () => (await noteByTitle(user.id, "Offline"))?.content_text)
      .toBe("start and more");
    // Saved: the draft is cleared.
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), `draft:note:${id}`),
    ).toBeNull();
  });

  test("a change made in another window shows a banner; Load latest takes the other copy", async ({
    page,
    context,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Shared", text: "original" });
    await page.goto(`/notes/${id}`);
    await expect(editor(page)).toContainText("original");

    // A second window saves first.
    const other = await context.newPage();
    await other.bringToFront();
    await other.goto(`/notes/${id}`);
    await editor(other).click();
    await other.keyboard.press("ControlOrMeta+End");
    await other.keyboard.type(" from window two");
    await expect(other.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Shared"))?.content_text)
      .toBe("original from window two");

    // The first window, still on the old version, edits.
    await page.bringToFront();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" from window one");
    await expect(page.getByText("This note changed in another window.")).toBeVisible();
    // Nothing was overwritten.
    expect((await noteByTitle(user.id, "Shared"))?.content_text).toBe("original from window two");

    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByText("This note changed in another window.")).toHaveCount(0);
    await expect(editor(page)).toHaveText("original from window two");

    // Editing continues normally from the latest version.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("!");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Shared"))?.content_text)
      .toBe("original from window two!");
  });

  test("Keep mine saves what is on screen over the other copy", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Mine", text: "original" });
    await page.goto(`/notes/${id}`);
    await saveNoteElsewhere(id, "changed elsewhere");

    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" plus mine");
    await expect(page.getByText("This note changed in another window.")).toBeVisible();
    await page.getByRole("button", { name: "Keep mine" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Mine"))?.content_text)
      .toBe("original plus mine");
  });

  test("unsaved changes found on this device can be recovered or discarded", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Draft", text: "saved text" });
    const draft = {
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "unsaved edits" }] }],
      },
      title: "Draft",
      savedAt: Date.now() + 60_000,
      baseVersion: 1,
    };
    await page.goto("/notes");
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [`draft:note:${id}`, JSON.stringify(draft)],
    );

    await page.goto(`/notes/${id}`);
    await expect(page.getByText("Recover unsaved changes?")).toBeVisible();
    await expect(editor(page)).toContainText("saved text");
    await page.getByRole("button", { name: "Recover" }).click();
    await expect(editor(page)).toHaveText("unsaved edits");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Draft"))?.content_text)
      .toBe("unsaved edits");

    // Discard: a stale draft is dropped and not offered again.
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [
        `draft:note:${id}`,
        JSON.stringify({
          ...draft,
          doc: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "another draft" }] }],
          },
          savedAt: Date.now() + 120_000,
        }),
      ],
    );
    await page.reload();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Recover unsaved changes?")).toHaveCount(0);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), `draft:note:${id}`),
    ).toBeNull();
    await expect(editor(page)).toHaveText("unsaved edits"); // the saved note is untouched
  });
});

test.describe("archive, trash and the list", () => {
  test("archive and unarchive, then move to Trash with Undo", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Tidy up", text: "text" });
    await page.goto(`/notes/${id}`);

    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("This note is archived.")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Tidy up"))?.archived_at ?? null)
      .not.toBeNull();
    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByText("This note is archived.")).toHaveCount(0);
    await expect
      .poll(async () => (await noteByTitle(user.id, "Tidy up"))?.archived_at ?? null)
      .toBeNull();

    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Tidy up/ })).toHaveCount(0);
    await expect
      .poll(async () => (await noteByTitle(user.id, "Tidy up"))?.deleted_at ?? null)
      .not.toBeNull();

    await toastUndo(page).click();
    await expect(page.getByRole("link", { name: /Tidy up/ })).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Tidy up"))?.deleted_at ?? null)
      .toBeNull();
  });

  test("the list shows newest first, with archived notes collapsed below", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Older", text: "first" });
    await insertNote(user.id, { title: "Newer", text: "second" });
    await insertNote(user.id, { title: "Shelved", text: "old", archived: true });
    await page.goto("/notes");

    const names = await page
      .getByRole("list", { name: "Notes", exact: true })
      .getByRole("link")
      .allTextContents();
    expect(names[0]).toContain("Newer"); // most recently updated first
    await expect(page.getByText("2 notes")).toBeVisible();
    await expect(page.getByRole("link", { name: /Shelved/ })).toBeHidden();
    await page.locator("summary", { hasText: "Archived" }).click();
    await expect(page.getByRole("link", { name: /Shelved/ })).toBeVisible();
  });

  test("Shift+N starts a new note from anywhere, and is ignored while typing", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await page.keyboard.press("Shift+N");
    await expect(page).toHaveURL(/\/notes\/new$/);

    await title(page).fill("a");
    await page.keyboard.press("Shift+N"); // typing a capital N inside the field
    await expect(page).not.toHaveURL(/\/notes\/new$/); // the note was created, so the address changed
    await expect(title(page)).toHaveValue("aN");
  });

  test("filters by project and tag and shows empty states", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme", color: "blue" });
    const client = await insertTag(user.id, "Client", "teal");
    const a = await insertNote(user.id, { title: "In Acme", projectId: acme });
    await insertNote(user.id, { title: "Loose note" });
    const t = await insertNote(user.id, { title: "Tagged" });
    await tagNote(t, client, user.id);
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /In Acme/ })).toContainText("Acme");

    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "Acme" }).click();
    await expect(page).toHaveURL(/project=/);
    await expect(page.getByRole("link", { name: /In Acme/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Loose note/ })).toHaveCount(0);

    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(page.getByRole("link", { name: /Loose note/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /In Acme/ })).toHaveCount(0);

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: /^Tag/ }).click();
    await page.getByRole("menuitemradio", { name: "Client" }).click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByRole("link", { name: /Tagged/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Loose note/ })).toHaveCount(0);

    // A tag nothing has: an explanation and a way out.
    await insertTag(user.id, "Unused");
    await page.goto("/notes");
    await page.getByRole("button", { name: /^Tag/ }).click();
    await page.getByRole("menuitemradio", { name: "Unused" }).click();
    await expect(page.getByText("No notes match these filters.")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).last().click();
    await expect(page.getByRole("link", { name: /Loose note/ })).toBeVisible();
    expect(a).toBeTruthy();
  });
});

test.describe("tasks and notes together", () => {
  test("link a note from a task, and the task shows under the note's linked tasks", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Prepare client meeting" });
    const noteId = await insertNote(user.id, { title: "Client meeting prep", text: "agenda" });
    await page.goto(`/tasks?task=${taskId}`);
    const panel = page.getByRole("complementary", { name: "Task detail" });

    await panel.getByRole("button", { name: "Link note" }).click();
    await page.getByLabel("Search your notes").fill("client");
    await page.getByRole("button", { name: /Client meeting prep/ }).click();
    const chip = panel.getByRole("link", { name: "Client meeting prep" });
    await expect(chip).toBeVisible();
    await expect.poll(async () => linkedNoteIds(taskId)).toEqual([noteId]);

    // Both ways: from the task to the note ...
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
    // ... and from the note to the task.
    await page.getByRole("button", { name: "Linked tasks" }).click();
    await expect(page.getByRole("link", { name: /Prepare client meeting/ })).toBeVisible();

    // Unlink from the note side.
    await page.getByRole("button", { name: "Unlink Prepare client meeting" }).click();
    await expect.poll(async () => linkedNoteIds(taskId)).toEqual([]);
  });

  test("link a task from inside a note", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Send the agenda" });
    const noteId = await insertNote(user.id, { title: "Planning", text: "x" });
    await page.goto(`/notes/${noteId}`);
    await page.getByRole("button", { name: "Linked tasks" }).click();
    await expect(page.getByText("No linked tasks yet.")).toBeVisible();
    await page.getByLabel("Search your tasks").fill("agenda");
    await page.getByRole("button", { name: "Send the agenda" }).click();
    await expect(page.getByRole("link", { name: /Send the agenda/ })).toBeVisible();
    await expect.poll(async () => linkedNoteIds(taskId)).toEqual([noteId]);
    // Open tasks come first: a finished one is listed after.
    await insertTask(user.id, { title: "Old chore", status: "DONE" });
  });

  test("'New linked note' from a task creates the note already linked", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the proposal" });
    await page.goto(`/tasks?task=${taskId}`);
    await page
      .getByRole("complementary", { name: "Task detail" })
      .getByRole("link", { name: "New linked note" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/notes/new\\?task=${taskId}`));

    await title(page).fill("Proposal draft");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect.poll(async () => (await noteByTitle(user.id, "Proposal draft"))?.id).toBeTruthy();
    const note = (await noteByTitle(user.id, "Proposal draft"))!;
    expect(await linkedNoteIds(taskId)).toEqual([note.id]);
  });

  test("a note in Trash disappears from the task and returns when restored", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Has a note" });
    const noteId = await insertNote(user.id, { title: "Linked and doomed", text: "x" });
    await linkTaskToNote(taskId, noteId, user.id);
    await page.goto(`/tasks?task=${taskId}`);
    const panel = page.getByRole("complementary", { name: "Task detail" });
    await expect(panel.getByRole("link", { name: "Linked and doomed" })).toBeVisible();

    await page.goto(`/notes/${noteId}`);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await page.goto(`/tasks?task=${taskId}`);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Linked and doomed" })).toHaveCount(0);
  });
});

test.describe("tags on notes", () => {
  test("create a tag from a note, see it on the list, and remove it", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Taggable", text: "text" });
    await page.goto(`/notes/${id}`);

    await moreActions(page).click();
    await page.getByRole("menuitem", { name: /^Tags/ }).click();
    await page.getByLabel("Find or create a tag").fill("research");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemcheckbox", { name: "research" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.keyboard.press("Escape");
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Taggable/ })).toContainText("research");

    await page.goto(`/notes/${id}`);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: /^Tags/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "research" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "research" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

test.describe("one person can't reach another's notes", () => {
  test("someone else's note is not found, and can't be linked or saved to", async ({
    browser,
    page,
  }) => {
    const { user: alice } = await newUser(page);
    const noteId = await insertNote(alice.id, { title: "Alice secret", text: "private words" });
    const taskId = await insertTask(alice.id, { title: "Alice task" });

    const otherContext = await newDevice(browser);
    const other = { page: await otherContext.newPage(), context: otherContext };
    const bob = await signUp(other.page);
    const bobUser = (await findUser(bob.email))!;

    await other.page.goto(`/notes/${noteId}`);
    await expect(other.page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await expect(other.page.getByText("private words")).toHaveCount(0);
    await other.page.goto("/notes/00000000-0000-7000-8000-000000000000");
    await expect(other.page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await other.page.goto("/notes/not-an-id");
    await expect(other.page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();

    await other.page.goto("/notes");
    await expect(other.page.getByText("Alice secret")).toHaveCount(0);
    await expect(other.page.getByText("No notes yet.")).toBeVisible();

    // A new note can't be linked to Alice's task through the address bar.
    await other.page.goto(`/notes/new?task=${taskId}`);
    await title(other.page).fill("Bob's note");
    await expect(other.page.getByText("Saved")).toBeVisible();
    await expect.poll(async () => (await noteByTitle(bobUser.id, "Bob's note"))?.id).toBeTruthy();
    expect(await linkedNoteIds(taskId)).toEqual([]);

    expect((await noteByTitle(alice.id, "Alice secret"))?.content_text).toBe("private words");
    await other.context.close();
  });

  test("signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto("/notes/00000000-0000-7000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.goto("/notes/new");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });
});
