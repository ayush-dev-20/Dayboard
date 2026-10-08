import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  childNoteIds,
  findUser,
  insertManyNotes,
  insertNote,
  noteByTitle,
  noteTreeInfo,
} from "./db";
import { signUp } from "./helpers";

// V2 feature 07: the sidebar tree, the Tree view, "Move to…", and dragging.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const tree = (page: Page) => page.getByRole("tree", { name: "Notes" }).first();
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const showTree = async (page: Page) => {
  const toggle = page.getByRole("button", { name: "Show notes tree" });
  if (await toggle.isVisible()) await toggle.click();
};

/** A small family: Work > Plan > OKRs, Work > Meeting; Home > Groceries; Reading. */
async function family(userId: string) {
  const work = await insertNote(userId, { title: "Work", sortOrder: 0 });
  const plan = await insertNote(userId, { title: "Plan", parentId: work, sortOrder: 0 });
  const okrs = await insertNote(userId, { title: "OKRs", parentId: plan, sortOrder: 0 });
  const meeting = await insertNote(userId, { title: "Meeting", parentId: work, sortOrder: 1024 });
  const home = await insertNote(userId, { title: "Home", sortOrder: 1024 });
  const groceries = await insertNote(userId, { title: "Groceries", parentId: home, sortOrder: 0 });
  const reading = await insertNote(userId, { title: "Reading", sortOrder: 2048 });
  return { work, plan, okrs, meeting, home, groceries, reading };
}

/** A mouse drag in steps, ending at a point `at` (0 top edge .. 1 bottom edge) of the target row. */
async function dragRow(page: Page, from: Locator, to: Locator, at = 0.5) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + 40, b.y + b.height * at, { steps: 12 });
  await page.mouse.up();
}
const rowOf = (page: Page, id: string) => page.locator(`[data-tree-row="${id}"]`).first();

test.describe("the sidebar tree", () => {
  test("expands to the open note, highlights it, and remembers which branches are open", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.okrs}`);
    await showTree(page);

    // Its ancestors opened by themselves, and it is the selected row.
    await expect(item(page, "OKRs")).toHaveAttribute("aria-selected", "true");
    await expect(item(page, "Plan")).toHaveAttribute("aria-expanded", "true");
    await expect(item(page, "Work")).toHaveAttribute("aria-expanded", "true");
    await expect(item(page, "Home")).toHaveAttribute("aria-expanded", "false");

    // Close Work from the keyboard, reload: the choice is remembered on this device.
    await item(page, "Work").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(item(page, "Work")).toHaveAttribute("aria-expanded", "false");
    await expect(item(page, "Plan")).toHaveCount(0);
    await page.goto("/notes");
    await expect(tree(page)).toBeVisible();
    await expect(item(page, "Work")).toHaveAttribute("aria-expanded", "false");
    // The tree itself can be hidden, and stays hidden.
    await page.getByRole("button", { name: "Hide notes tree" }).click();
    await page.reload();
    await expect(page.getByRole("tree", { name: "Notes" })).toHaveCount(0);
  });

  test("the + on a row makes a sub-note and opens it ready for its title", async ({ page }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.reading}`);
    await showTree(page);

    await item(page, "Home").hover();
    await page.getByRole("button", { name: "New sub-note in Home" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Note title")).toBeFocused();
    await page.getByLabel("Note title").fill("Chores");
    await expect(page.getByText("Saved")).toBeVisible();

    const created = (await noteByTitle(user.id, "Chores"))!;
    expect(await noteTreeInfo(created.id)).toMatchObject({ parent_note_id: f.home, depth: 2 });
    // It is at the top of its level, and the tree shows it under Home with its new title.
    expect((await childNoteIds(f.home))[0]).toBe(created.id);
    await expect(item(page, "Chores")).toBeVisible();
  });

  test("the keyboard moves through the tree: arrows, Right and Left, Home and End, type-ahead, Enter", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto("/notes");
    await showTree(page);

    await item(page, "Work").focus();
    await page.keyboard.press("ArrowRight"); // opens Work
    await expect(item(page, "Work")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight"); // into Work
    await expect(item(page, "Plan")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(page, "Meeting")).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // to the parent
    await expect(item(page, "Work")).toBeFocused();
    await page.keyboard.press("End");
    await expect(item(page, "Reading")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item(page, "Work")).toBeFocused();
    await page.keyboard.type("hom"); // type-ahead
    await expect(item(page, "Home")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/notes/${f.home}$`));
  });

  test("Alt+Down and Alt+Up reorder among siblings, with Undo", async ({ page }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.work}`);
    await showTree(page);

    await item(page, "Work").focus();
    await page.keyboard.press("ArrowRight"); // open it so its sub-notes are rows
    await item(page, "Plan").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => childNoteIds(f.work)).toEqual([f.meeting, f.plan]);
    await expect(page.getByText("Moved down.")).toBeVisible();
    await page
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(async () => childNoteIds(f.work)).toEqual([f.plan, f.meeting]);
  });

  test("Move to… from the row menu: a loop and a too-deep place are disabled, a good one moves it", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto(`/notes/${f.home}`);
    await showTree(page);

    await item(page, "Work").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Move “Work” to…");
    // Itself and everything inside it can't be chosen.
    for (const name of ["Work", "Plan", "OKRs", "Meeting"]) {
      await expect(dialog.getByRole("option", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await dialog.getByPlaceholder("Search notes").fill("groc");
    await dialog.getByRole("option", { name: /Groceries/ }).click();
    await expect.poll(async () => (await noteTreeInfo(f.work))?.parent_note_id).toBe(f.groceries);
    expect((await noteTreeInfo(f.okrs))?.depth).toBe(5);
    await expect(page.getByText("Moved into Groceries.")).toBeVisible();

    // Now `Home` can't take anything that would end deeper than five levels.
    await item(page, "Home").focus();
    await expect(item(page, "Home")).toBeVisible();
  });

  test("dragging a row onto another nests it; between rows reorders; a loop is refused", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto("/notes");
    await showTree(page);
    await item(page, "Work").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // open Plan too
    await expect(item(page, "OKRs")).toBeVisible();

    // Onto Home (the middle of the row): Reading becomes its sub-note.
    await dragRow(page, rowOf(page, f.reading), rowOf(page, f.home), 0.5);
    await expect.poll(async () => (await noteTreeInfo(f.reading))?.parent_note_id).toBe(f.home);
    expect((await noteTreeInfo(f.reading))?.depth).toBe(2);

    // Above Work (its top edge): Reading goes to the top level, before Work.
    await item(page, "Home").focus();
    await page.keyboard.press("ArrowRight"); // Reading is inside Home now: open it
    await dragRow(page, rowOf(page, f.reading), rowOf(page, f.work), 0.05);
    await expect.poll(async () => (await noteTreeInfo(f.reading))?.parent_note_id).toBeNull();
    const [reading, work] = [await noteTreeInfo(f.reading), await noteTreeInfo(f.work)];
    expect(reading!.sort_order).toBeLessThan(work!.sort_order);

    // Work into its own sub-note OKRs: refused with the same words as the server, nothing moves.
    await dragRow(page, rowOf(page, f.work), rowOf(page, f.okrs), 0.5);
    await expect(
      page.getByText("A note can't be moved into itself or into one of its own sub-notes."),
    ).toBeVisible();
    expect((await noteTreeInfo(f.work))?.parent_note_id).toBeNull();
  });

  test("past 50 top-level notes the tree shows 50 and a link to all of them", async ({ page }) => {
    const { user } = await newUser(page);
    await insertManyNotes(user.id, 55);
    await page.goto("/notes");
    await showTree(page);
    await expect(tree(page).getByRole("treeitem")).toHaveCount(50);
    await page.getByRole("link", { name: "Show all notes (55)" }).click();
    await expect(page).toHaveURL(/\/notes$/);
  });
});

test.describe("the Tree view", () => {
  test("shows the whole outline, open, and a depth-5 note has no + for another level", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto("/notes");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Tree", exact: true }).last().click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    const outline = page.getByRole("tree", { name: "Notes" }).last();
    for (const name of ["Work", "Plan", "OKRs", "Meeting", "Home", "Groceries", "Reading"]) {
      await expect(outline.getByRole("treeitem", { name, exact: true })).toBeVisible();
    }
    await expect(outline.getByRole("treeitem", { name: "OKRs", exact: true })).toHaveAttribute(
      "aria-level",
      "3",
    );
    // A move in the view is the same move.
    await outline.getByRole("treeitem", { name: "Reading", exact: true }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(async () => {
        const [r, h] = [await noteTreeInfo(f.reading), await noteTreeInfo(f.home)];
        return r!.sort_order < h!.sort_order;
      })
      .toBe(true);
  });

  test("the main views list top-level notes only: no sub-notes in the List, Table, Board or Gallery", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await family(user.id);
    await page.goto("/notes");
    // The List: the three top-level notes, no expand control, a count that matches.
    const list = page.getByRole("list", { name: "Notes", exact: true });
    await expect(list.getByRole("link", { name: /^Work/ })).toBeVisible();
    await expect(list.getByRole("link", { name: /^Home/ })).toBeVisible();
    await expect(list.getByRole("link", { name: /^Reading/ })).toBeVisible();
    await expect(page.getByText("3 notes", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sub-notes of/ })).toHaveCount(0);
    for (const sub of ["Plan", "OKRs", "Meeting", "Groceries"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${sub}`) })).toHaveCount(0);
    }

    // The same in every other view.
    for (const view of ["Table", "Gallery", "Board"]) {
      await page.getByRole("button", { name: "View", exact: true }).click();
      await page.getByRole("menuitem", { name: view, exact: true }).last().click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByText("Work").first()).toBeVisible();
      await expect(page.getByText("Groceries")).toHaveCount(0);
      await expect(page.getByText("OKRs")).toHaveCount(0);
    }
  });
});

test.describe("paths in search", () => {
  test("a note's path shows next to its title in the command menu and on the search page", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const f = await family(user.id);
    await page.goto("/notes");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/Search, ask or create/).fill("OKRs");
    const result = page.getByRole("option").filter({ hasText: "Work / Plan /" });
    await expect(result).toContainText("OKRs");
    await page.keyboard.press("Escape");

    await page.goto("/search?q=OKRs");
    await expect(page.getByRole("link", { name: /Work \/ Plan \/ OKRs/ })).toBeVisible();
    expect((await noteTreeInfo(f.okrs))?.depth).toBe(3);
  });
});
