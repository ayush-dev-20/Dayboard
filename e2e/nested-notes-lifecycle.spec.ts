import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  backlinkRows,
  childNoteIds,
  findUser,
  insertBacklink,
  insertNote,
  insertTask,
  noteDoc,
  noteTreeInfo,
  notesOf,
  setNoteDoc,
} from "./db";
import { signUp } from "./helpers";

// V2 feature 07: Trash and archive follow the hierarchy, task descriptions, copy and paste,
// accessibility and the phone.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const moreActions = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const tree = (page: Page) => page.getByRole("tree", { name: "Notes" }).first();
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const showTree = async (page: Page) => {
  const toggle = page.getByRole("button", { name: "Show notes tree" });
  if (await toggle.isVisible()) await toggle.click();
};
const frontToast = (page: Page) => page.locator('[data-sonner-toast][data-front="true"]');
const undo = (page: Page) => frontToast(page).getByRole("button", { name: "Undo" });

const doc = (...content: unknown[]) => ({ type: "doc", content });
const text = (t: string) => ({ type: "text", text: t });
const para = (...c: unknown[]) => ({ type: "paragraph", content: c });
const link = (noteId: string) => ({ type: "noteLink", attrs: { noteId } });
const block = (noteId: string) => ({ type: "subNote", attrs: { noteId } });

/** parent > a, b ; a > a1 */
async function family(userId: string) {
  const parent = await insertNote(userId, { title: "Parent" });
  const a = await insertNote(userId, { title: "Child A", parentId: parent, sortOrder: 0 });
  const a1 = await insertNote(userId, { title: "Grandchild", parentId: a, sortOrder: 0 });
  const b = await insertNote(userId, { title: "Child B", parentId: parent, sortOrder: 1024 });
  return { parent, a, a1, b };
}

const deletedAt = async (id: string) => (await noteTreeInfo(id))?.deleted_at ?? null;

test.describe("Trash and archive follow the hierarchy", () => {
  test("trashing a parent takes its sub-notes, says so, and one Undo brings every one back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.parent}`);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash. 3 sub-notes went with it.")).toBeVisible();
    for (const id of [f.parent, f.a, f.a1, f.b]) expect(await deletedAt(id)).not.toBeNull();

    await undo(page).click();
    await expect.poll(async () => deletedAt(f.a1)).toBeNull();
    for (const id of [f.parent, f.a, f.b]) expect(await deletedAt(id)).toBeNull();
  });

  test("Trash lists the parent with its count, restoring it restores exactly its set, and the earlier one stays", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.parent}`);
    await showTree(page);
    await item(page, "Parent").focus();
    await page.keyboard.press("ArrowRight");

    // Child A goes to Trash on its own first (with Grandchild), then the parent.
    await item(page, "Child A").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash. 1 sub-note went with it.")).toBeVisible();
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect.poll(async () => deletedAt(f.parent)).not.toBeNull();

    await page.goto("/trash?type=note");
    const parentRow = page.locator("li", { hasText: "Parent" }).first();
    await expect(parentRow).toContainText("Includes 1 sub-note");
    // Grandchild travels with Child A, which is listed on its own.
    await expect(page.locator("li", { hasText: "Child A" })).toContainText("Includes 1 sub-note");
    await expect(page.locator("li", { hasText: "Child B" })).toHaveCount(0);

    await page.getByRole("button", { name: "Restore Parent" }).click();
    await expect.poll(async () => deletedAt(f.parent)).toBeNull();
    expect(await deletedAt(f.b)).toBeNull();
    // The one trashed earlier is still in Trash, with its own.
    expect(await deletedAt(f.a)).not.toBeNull();
    expect(await deletedAt(f.a1)).not.toBeNull();
  });

  test("restoring a sub-note whose parent is still in Trash asks about a top-level note", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.parent}`);
    await showTree(page);
    await item(page, "Parent").focus();
    await page.keyboard.press("ArrowRight");
    await item(page, "Child B").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to Trash" }).click(); // B alone
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click(); // the rest
    await expect.poll(async () => deletedAt(f.parent)).not.toBeNull();

    await page.goto("/trash?type=note");
    await page.getByRole("button", { name: "Restore Child B" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Restore as a top-level note?");
    await dialog.getByRole("button", { name: "Restore as top-level" }).click();
    await expect.poll(async () => deletedAt(f.b)).toBeNull();
    expect(await noteTreeInfo(f.b)).toMatchObject({ parent_note_id: null, depth: 1 });
    expect(await deletedAt(f.parent)).not.toBeNull();
  });

  test("deleting for good names how many sub-notes go with it", async ({ page }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.parent}`);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await page.goto("/trash?type=note");
    await page
      .locator("li", { hasText: "Parent" })
      .getByRole("button", { name: /More actions/ })
      .click();
    await page.getByRole("menuitem", { name: "Delete permanently" }).click();
    await expect(page.getByRole("dialog")).toContainText("This also deletes 3 sub-notes.");
    await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect.poll(async () => noteTreeInfo(f.a1)).toBeNull();
    expect(await noteTreeInfo(f.parent)).toBeNull();
    // Empty trash counts what it removes.
  });

  test("archiving a parent archives its sub-notes, and Undo restores the same set", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.parent}`);
    await showTree(page);
    await moreActions(page).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("Note archived with 3 sub-notes.")).toBeVisible();
    for (const id of [f.parent, f.a, f.a1, f.b]) {
      expect((await noteTreeInfo(id))?.archived_at).not.toBeNull();
    }
    // Archived notes are not in the sidebar tree.
    await expect(item(page, "Parent")).toHaveCount(0);
    await undo(page).click();
    await expect.poll(async () => (await noteTreeInfo(f.a1))?.archived_at).toBeNull();
    await expect(item(page, "Parent")).toBeVisible();
  });
});

test.describe("task descriptions", () => {
  test("New linked note makes a note, links the task to it, and puts a link in the text; no sub-note here", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const task = await insertTask(user.id, { title: "Plan the launch" });
    await page.goto(`/tasks?task=${task}`);
    const description = page.getByRole("textbox", { name: "Task description" });
    await description.click();
    await page.keyboard.type("/");
    await expect(page.getByRole("option", { name: "Sub-note" })).toHaveCount(0);
    await page.keyboard.type("linked");
    await page.getByRole("option", { name: "New linked note" }).click();

    await expect(description.getByRole("link", { name: /Link to note/ })).toBeVisible();
    await expect(page.getByText("Saved").first()).toBeVisible();
    // The note exists, is top level, and the backlink list names the task.
    const created = await notesOf(user.id);
    expect(created).toHaveLength(1);
    expect((await noteTreeInfo(created[0]!.id))?.parent_note_id).toBeNull();
    expect((await backlinkRows(created[0]!.id)).map((r) => r.source_type)).toEqual(["TASK"]);
  });
});

test.describe("copy and paste", () => {
  test("a note with a link and a sub-note block copies as ordinary links and pastes back as the real thing", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const target = await insertNote(user.id, { title: "Roadmap" });
    const child = await insertNote(user.id, { title: "Meeting notes" });
    const source = await insertNote(user.id, { title: "Source" });
    await setNoteDoc(source, doc(para(text("see "), link(target)), block(child)));
    const dest = await insertNote(user.id, { title: "Destination" });

    await page.goto(`/notes/${source}`);
    await expect(editor(page).getByRole("link", { name: /Roadmap/ })).toBeVisible();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    const flavours = await page.evaluate(async () => {
      let out: Record<string, string> = {};
      document.addEventListener(
        "copy",
        (e) => {
          out = Object.fromEntries(
            Array.from(e.clipboardData!.types).map((t) => [t, e.clipboardData!.getData(t)]),
          );
        },
        { once: true },
      );
      document.execCommand("copy");
      await new Promise((r) => setTimeout(r, 50));
      return out;
    });
    // Ordinary links for other tools, with the notes' titles.
    expect(flavours["text/html"]).toMatch(/<a href="[^"]*\/notes\/[0-9a-f-]{36}">Roadmap<\/a>/);
    expect(flavours["text/html"]).toContain("Meeting notes</a>");
    expect(flavours["text/plain"]).toContain("[Roadmap](");

    await page.goto(`/notes/${dest}`);
    await editor(page).click();
    await page.evaluate((data) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, flavours);
    await expect(editor(page).getByRole("link", { name: "Link to note: Roadmap" })).toBeVisible();
    await expect(page.locator(`[data-sub-note-id="${child}"]`)).toContainText("Meeting notes");
    await expect(page.getByText("Saved")).toBeVisible();
    expect(JSON.stringify(await noteDoc(dest))).toContain('"subNote"');
  });

  test("a pasted note address becomes a link; the note's own address stays text", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const other = await insertNote(user.id, { title: "Other note" });
    const me = await insertNote(user.id, { title: "Me" });
    await page.goto(`/notes/${me}`);
    await editor(page).click();
    const paste = (value: string) =>
      page.evaluate((v) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", v);
        document.activeElement!.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      }, value);
    const origin = new URL(page.url()).origin;
    await paste(`${origin}/notes/${other}`);
    await expect(
      editor(page).getByRole("link", { name: "Link to note: Other note" }),
    ).toBeVisible();
    await paste(`${origin}/notes/${me}`);
    await expect(editor(page)).toContainText(`/notes/${me}`);
    await expect(editor(page).getByRole("link", { name: /Link to note: Me/ })).toHaveCount(0);
  });
});

test.describe("accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the tree, the pills, the blocks, the backlinks and the Tree view pass axe in ${colorScheme} mode`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      const { user } = await newUser(page);
      const f = await family(user.id);
      const holder = await insertNote(user.id, { title: "Holder" });
      await setNoteDoc(
        holder,
        doc(para(text("see "), link(f.parent), text(" and "), link(f.b)), block(f.a)),
      );
      await insertBacklink(user.id, "NOTE", holder, f.parent, "see Parent and Child B");

      const scan = async (label: string) => {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const serious = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map(
            (v) =>
              `${v.id}: ${v.help}\n${v.nodes
                .slice(0, 4)
                .map((n) => `   ${n.target.join(" ")}`)
                .join("\n")}`,
          );
        expect(serious, `${label}\n${serious.join("\n")}`).toEqual([]);
      };

      await page.goto(`/notes/${holder}`);
      await showTree(page);
      await expect(editor(page).getByRole("link", { name: /Link to note: Parent/ })).toBeVisible();
      await scan("note with pills, a block and the tree");

      await page.goto(`/notes/${f.parent}`);
      await page.getByRole("button", { name: /Linked from/ }).click();
      await expect(page.getByRole("region", { name: "Linked from" })).toContainText("Holder");
      await scan("a note with Linked from open and a Sub-notes list");

      await page.goto("/notes");
      await page.getByRole("button", { name: "View", exact: true }).click();
      await page.getByRole("menuitem", { name: "Tree", exact: true }).last().click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByRole("tree", { name: "Notes" }).last()).toBeVisible();
      await scan("the Tree view");
    });
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test("the tree opens in a sheet and a note opens from it; nothing scrolls sideways", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto("/notes");
    await page.getByRole("button", { name: "Browse notes" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("treeitem", { name: "Parent", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await sheet.getByRole("treeitem", { name: "Child A", exact: true }).locator("a").click();
    await expect(page).toHaveURL(new RegExp(`/notes/${f.a}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    // The breadcrumb is hidden on a phone; the back arrow goes to the parent.
    await page.getByRole("link", { name: "Back to the parent note" }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${f.parent}$`));
    expect((await childNoteIds(f.parent)).length).toBe(2);
  });
});
