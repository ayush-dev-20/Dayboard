import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  backlinkRows,
  childNoteIds,
  findUser,
  insertNote,
  insertTask,
  noteByTitle,
  noteDoc,
  noteTreeInfo,
  purgeNoteElsewhere,
  restoreNoteElsewhere,
  setNoteDoc,
  trashNoteElsewhere,
} from "./db";
import { signUp } from "./helpers";

// V2 feature 07 (acceptance, product spec §16.6): sub-notes, note links, backlinks, the sidebar
// tree, the Tree view, cascades, task descriptions.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const title = (page: Page) => page.getByLabel("Note title");
const moreActions = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const breadcrumb = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });

const doc = (...content: unknown[]) => ({ type: "doc", content });
const text = (t: string) => ({ type: "text", text: t });
const para = (...c: unknown[]) => ({ type: "paragraph", content: c });
const link = (noteId: string) => ({ type: "noteLink", attrs: { noteId } });
const block = (noteId: string) => ({ type: "subNote", attrs: { noteId } });

test.describe("sub-notes", () => {
  test("make one from the / menu, see its block, open it, and come back through the breadcrumb", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/notes/new");
    await title(page).fill("Parent note");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Intro");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/sub");
    await page.getByRole("option", { name: "Sub-note" }).click();

    // The block shows the new sub-note, which exists at once (an explicit action).
    const rowBlock = page.locator("[data-sub-note-id]");
    await expect(rowBlock).toContainText("Untitled");
    const parent = (await noteByTitle(user.id, "Parent note"))!;
    await expect.poll(async () => (await childNoteIds(parent.id)).length).toBe(1);
    const [childId] = await childNoteIds(parent.id);
    expect(await noteTreeInfo(childId!)).toMatchObject({ parent_note_id: parent.id, depth: 2 });

    // Open it: the title is ready for typing, and the breadcrumb names where it lives.
    await rowBlock.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/notes/${childId}$`));
    await expect(title(page)).toBeFocused();
    await expect(breadcrumb(page)).toContainText("Notes");
    await expect(breadcrumb(page).getByRole("link", { name: "Parent note" })).toBeVisible();
    await title(page).fill("Child note");
    await expect(page.getByText("Saved")).toBeVisible();

    await breadcrumb(page).getByRole("link", { name: "Parent note" }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${parent.id}$`));
    // The block now shows the title it was given.
    await expect(page.locator("[data-sub-note-id]")).toContainText("Child note");
  });

  test("deleting a block removes only the block: the sub-note stays and is listed under Sub-notes", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const parent = await insertNote(user.id, { title: "Holder" });
    const child = await insertNote(user.id, { title: "Kept child", parentId: parent });
    await setNoteDoc(parent, doc(para(text("before")), block(child)));

    await page.goto(`/notes/${parent}`);
    const rowBlock = page.locator(`[data-sub-note-id="${child}"]`);
    await expect(rowBlock).toContainText("Kept child");
    // No separate list while its block is in the text.
    await expect(page.getByRole("heading", { name: /Sub-notes/ })).toHaveCount(0);

    // Arrow onto the block (it is selected, not opened) and delete it.
    await editor(page).getByText("before").click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Backspace");
    await expect(page.getByText("Saved")).toBeVisible();
    expect(await noteTreeInfo(child)).toMatchObject({ parent_note_id: parent, deleted_at: null });
    await expect(page.locator("[data-sub-note-id]")).toHaveCount(0);

    // It still shows, at the end of the parent.
    const section = page.getByRole("region", { name: /Sub-notes/ });
    await expect(section).toContainText("Kept child");
    await section.getByRole("link", { name: /Kept child/ }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${child}$`));
  });

  test("a block for a sub-note in Trash shows nothing, and is back when the note is restored", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const parent = await insertNote(user.id, { title: "Holder two" });
    const child = await insertNote(user.id, { title: "Goes to Trash", parentId: parent });
    await setNoteDoc(parent, doc(para(text("text")), block(child)));
    await page.goto(`/notes/${parent}`);
    await expect(page.locator(`[data-sub-note-id="${child}"]`)).toContainText("Goes to Trash");

    await trashNoteElsewhere(child);
    await page.reload();
    // Nothing in the note: no "Deleted note" row, no Restore button, and no Sub-notes list either.
    await expect(page.locator(`[data-sub-note-id="${child}"]`)).toBeHidden();
    await expect(page.getByText("Deleted note")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Restore/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Sub-notes/ })).toHaveCount(0);

    await restoreNoteElsewhere(child);
    await page.reload();
    await expect(page.locator(`[data-sub-note-id="${child}"]`)).toContainText("Goes to Trash");
  });

  test("a sixth level is refused with a clear message", async ({ page }) => {
    const { user } = await newUser(page);
    let parent = await insertNote(user.id, { title: "L1" });
    for (let level = 2; level <= 5; level++) {
      parent = await insertNote(user.id, { title: `L${level}`, parentId: parent });
    }
    await page.goto(`/notes/${parent}`);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "New sub-note" }).click();
    await expect(page.getByText("Notes can be nested five levels deep.")).toBeVisible();
    expect(await childNoteIds(parent)).toHaveLength(0);
  });
});

test.describe("note links", () => {
  test("@ links to another note, a rename updates the pill, and a ctrl-click opens a new tab", async ({
    page,
    context,
  }) => {
    const { user } = await newUser(page);
    const target = await insertNote(user.id, { title: "Roadmap", emoji: "🗺️" });
    await insertNote(user.id, { title: "Budget" });
    const source = await insertNote(user.id, { title: "Meeting" });

    await page.goto(`/notes/${source}`);
    await editor(page).click();
    await page.keyboard.type("see @road");
    await page.getByRole("option", { name: /Roadmap/ }).click();
    const pill = editor(page).getByRole("link", { name: "Link to note: Roadmap" });
    await expect(pill).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
    expect((await backlinkRows(target)).map((r) => r.source_id)).toEqual([source]);

    // Renaming the target changes what the pill shows, with nothing to edit in the source.
    await page.goto(`/notes/${target}`);
    await title(page).fill("Product roadmap");
    await expect(page.getByText("Saved")).toBeVisible();
    await page.goto(`/notes/${source}`);
    await expect(
      editor(page).getByRole("link", { name: "Link to note: Product roadmap" }),
    ).toBeVisible();

    // Cmd/Ctrl-click opens it in a new tab.
    const opened = context.waitForEvent("page");
    await editor(page)
      .getByRole("link", { name: "Link to note: Product roadmap" })
      .click({ modifiers: ["ControlOrMeta"] });
    const tab = await opened;
    await expect(tab).toHaveURL(new RegExp(`/notes/${target}$`));
    await tab.close();

    // A plain click opens it here.
    await editor(page).getByRole("link", { name: "Link to note: Product roadmap" }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${target}$`));
  });

  test("the picker offers Create as a note and as a sub-note, and never the note itself", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const me = await insertNote(user.id, { title: "Unique zebra" });
    await page.goto(`/notes/${me}`);
    await editor(page).click();
    await page.keyboard.type("@zebra");
    // The note being edited is not offered; the create entries are.
    await expect(page.getByRole("option", { name: /Unique zebra/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /as a note/ })).toBeVisible();
    await page.getByRole("option", { name: /as a sub-note of this one/ }).click();

    await expect.poll(async () => (await childNoteIds(me)).length).toBe(1);
    const [child] = await childNoteIds(me);
    expect((await noteTreeInfo(child!))?.depth).toBe(2);
    await expect(editor(page).getByRole("link", { name: "Link to note: zebra" })).toBeVisible();
  });

  test("links to a trashed note and to one deleted for good say so, and a restore revives the link", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const trashed = await insertNote(user.id, { title: "Soon trashed" });
    const gone = await insertNote(user.id, { title: "Soon gone" });
    const source = await insertNote(user.id, { title: "Links here" });
    await setNoteDoc(source, doc(para(link(trashed), text(" and "), link(gone))));

    await page.goto(`/notes/${source}`);
    await expect(
      editor(page).getByRole("link", { name: /Link to note: Soon trashed/ }),
    ).toBeVisible();

    // Trash one note and delete the other for good, from another window.
    await trashNoteElsewhere(trashed);
    await purgeNoteElsewhere(gone);
    await page.reload();

    const deleted = editor(page).getByRole("button", { name: /Link to a deleted note/ });
    await expect(deleted).toContainText("Deleted note");
    await expect(editor(page)).toContainText("Note no longer exists");

    // The trashed link offers Restore and Open Trash.
    await deleted.click();
    await expect(page.getByRole("button", { name: "Open Trash" })).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(
      editor(page).getByRole("link", { name: "Link to note: Soon trashed" }),
    ).toBeVisible();
  });
});

test.describe("linked from", () => {
  test("lists the notes and tasks that link here, and updates when a link goes", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const target = await insertNote(user.id, { title: "Linked target" });
    const source = await insertNote(user.id, { title: "Note source" });
    await setNoteDoc(source, doc(para(text("the "), link(target), text(" matters"))));
    // Save through the app so the backlink rows exist.
    await page.goto(`/notes/${source}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("!");
    await expect(page.getByText("Saved")).toBeVisible();
    const task = await insertTask(user.id, { title: "Task source" });
    await page.goto(`/tasks?task=${task}`);
    const description = page.getByRole("textbox", { name: "Task description" });
    await description.click();
    await page.keyboard.type("details @linked");
    await page.getByRole("option", { name: /Linked target/ }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();

    await page.goto(`/notes/${target}`);
    await page.getByRole("button", { name: /Linked from/ }).click();
    const list = page.getByRole("region", { name: "Linked from" });
    await expect(list).toContainText("Note source");
    await expect(list).toContainText("Task source");
    await expect(list.getByText("Note", { exact: true })).toBeVisible();
    await expect(list.getByText("Task", { exact: true })).toBeVisible();
    await expect(list).toContainText("the Linked target matters");

    // Removing the link removes the row.
    expect((await backlinkRows(target)).length).toBe(2);
    await page.goto(`/notes/${source}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect.poll(async () => (await backlinkRows(target)).length).toBe(1);
    expect(JSON.stringify(await noteDoc(source))).not.toContain("noteLink");
  });
});
