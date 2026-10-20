import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  boardOf,
  canvasesOf,
  findUser,
  insertCanvas,
  saveBoardElsewhere,
  setStickyDue,
  stickiesOf,
  stickyByTitle,
  taskTitlesOf,
} from "./db";
import { signUp } from "./helpers";

// V3 feature 01 slice D: sticky boards. A sticky note is a task of its own kind, so these tests read what was saved from
// the database as well as what the page shows.

test.use({ viewport: { width: 1440, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

/** Makes a board from a preset through the New canvas menu and waits for the page. */
async function newBoard(page: Page, preset = "Status board", firstColumn = "Planned") {
  await page.goto("/canvases");
  await page.getByRole("button", { name: "New canvas" }).first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${preset}`) }).click();
  await expect(page).toHaveURL(/\/canvases\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: firstColumn })).toBeVisible({ timeout: 30_000 });
  return page.url().split("/").pop()!;
}

const column = (page: Page, name: string): Locator => page.getByRole("list", { name });

async function addSticky(page: Page, columnName: string, text: string) {
  const box = page.getByLabel(`New sticky note in ${columnName}`);
  if (!(await box.isVisible())) {
    await page.getByRole("button", { name: `Add sticky note to ${columnName}` }).click();
  }
  await box.fill(text);
  await box.press("Enter");
  await expect(column(page, columnName).getByText(text, { exact: true })).toBeVisible();
}

async function closeAdd(page: Page, columnName: string) {
  const box = page.getByLabel(`New sticky note in ${columnName}`);
  if (await box.isVisible()) await box.press("Escape");
}

async function titlesIn(page: Page, columnName: string) {
  return column(page, columnName)
    .getByRole("button", { name: /^Edit sticky note/ })
    .allInnerTexts();
}

async function menuOf(page: Page, firstLine: string) {
  await page.getByRole("button", { name: `Options for ${firstLine}` }).click();
}

test.describe("creating a board and adding sticky notes", () => {
  test("a Status board has five columns; stickies keep their order after a reload and stay out of the task list", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    for (const name of ["Planned", "In progress", "Waiting", "Completed", "Cancelled"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    expect((await canvasesOf(user.id))[0]).toMatchObject({ id });
    expect((await boardOf(id))!.board_json.columns).toHaveLength(5);

    await addSticky(page, "Planned", "Write spec");
    await addSticky(page, "Planned", "Review PR");
    await closeAdd(page, "Planned");
    await addSticky(page, "In progress", "Fix bug");
    await closeAdd(page, "In progress");

    await page.reload();
    expect(await titlesIn(page, "Planned")).toEqual(["Write spec", "Review PR"]);
    expect(await titlesIn(page, "In progress")).toEqual(["Fix bug"]);
    const saved = await stickiesOf(id);
    expect(
      saved.map((s) => [s.title, s.status, s.kind]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([
      ["Fix bug", "IN_PROGRESS", "STICKY"],
      ["Review PR", "PLANNED", "STICKY"],
      ["Write spec", "PLANNED", "STICKY"],
    ]);

    // They are not in the Tasks list.
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
    await expect(page.getByText("Write spec")).toHaveCount(0);
    expect(await taskTitlesOf(user.id)).toContain("Write spec");
  });

  test("the list shows a Board marker and the sticky count", async ({ page }) => {
    test.slow();
    await newUser(page);
    await newBoard(page, "Simple", "To do");
    await addSticky(page, "To do", "One");
    await addSticky(page, "To do", "Two");
    await closeAdd(page, "To do");
    await page.goto("/canvases");
    const row = page
      .locator("main")
      .getByRole("link", { name: /Untitled board/ })
      .first();
    await expect(row).toContainText("Board");
    await expect(row).toContainText("2 sticky notes");
  });
});

test.describe("moving sticky notes", () => {
  test("Move to in the menu changes the column and the status; Completed shows a check, and a reload keeps it", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "In progress", "Fix bug");
    await closeAdd(page, "In progress");

    await menuOf(page, "Fix bug");
    await page.getByRole("menuitem", { name: "Completed", exact: true }).click();
    await expect(column(page, "Completed").getByText("Fix bug")).toBeVisible();
    await expect(column(page, "Completed").getByRole("img", { name: "Completed" })).toBeVisible();
    await expect.poll(async () => (await stickyByTitle(user.id, "Fix bug"))?.status).toBe("DONE");
    expect((await stickyByTitle(user.id, "Fix bug"))!.completed_at).not.toBeNull();

    await page.reload();
    await expect(column(page, "Completed").getByText("Fix bug")).toBeVisible();
    const columns = (await boardOf(id))!.board_json.columns;
    expect((await stickyByTitle(user.id, "Fix bug"))!.board_column_id).toBe(
      columns.find((c) => c.name === "Completed")!.id,
    );

    // Cancelled shows a cross and a struck-through title.
    await menuOf(page, "Fix bug");
    await page.getByRole("menuitem", { name: "Cancelled", exact: true }).click();
    await expect(column(page, "Cancelled").getByRole("img", { name: "Cancelled" })).toBeVisible();
  });

  test("Move up and Move down reorder inside a column, and the order is saved", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newBoard(page);
    for (const text of ["First", "Second", "Third"]) await addSticky(page, "Planned", text);
    await closeAdd(page, "Planned");

    await menuOf(page, "Third");
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => titlesIn(page, "Planned")).toEqual(["First", "Third", "Second"]);
    await menuOf(page, "First");
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect.poll(() => titlesIn(page, "Planned")).toEqual(["Third", "First", "Second"]);

    await page.reload();
    expect(await titlesIn(page, "Planned")).toEqual(["Third", "First", "Second"]);
    expect((await stickyByTitle(user.id, "Third"))!.sort_order).toBeLessThan(
      (await stickyByTitle(user.id, "First"))!.sort_order,
    );
  });

  test("a sticky can be dragged to another column with the mouse, and lifted and moved with the keyboard", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newBoard(page);
    await addSticky(page, "Planned", "Drag me");
    await addSticky(page, "Planned", "Lift me");
    await closeAdd(page, "Planned");

    // Mouse: press, move past the threshold, over the Waiting column, release.
    const card = column(page, "Planned").getByRole("listitem").filter({ hasText: "Drag me" });
    const from = (await card.boundingBox())!;
    const to = (await column(page, "Waiting").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
    await page.mouse.up();
    await expect(column(page, "Waiting").getByText("Drag me")).toBeVisible();
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Drag me"))?.status)
      .toBe("WAITING");

    // Keyboard: focus the grip, Space lifts, an arrow moves, Space drops.
    await page.getByRole("button", { name: "Move Lift me" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByText(/Picked up Lift me|Lift me is over/).first()).toBeAttached();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/Lift me is over (?!Planned)/).first()).toBeAttached();
    await page.keyboard.press("Space");
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Lift me"))?.status)
      .not.toBe("PLANNED");
    await expect(column(page, "Planned").getByText("Lift me")).toHaveCount(0);
  });

  test("a status changed in the task panel moves the sticky to the matching column", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "Planned", "Panel change");
    await closeAdd(page, "Planned");
    const sticky = (await stickyByTitle(user.id, "Panel change"))!;
    await page.goto(`/canvases/${id}?task=${sticky.id}`);
    const panel = page.getByRole("complementary", { name: "Task detail" });
    await expect(panel.getByLabel("Task title")).toHaveValue("Panel change");
    // No Repeat and no Subtasks on a sticky note.
    await expect(panel.getByRole("button", { name: /Repeat/ })).toHaveCount(0);
    await expect(panel.getByText("Subtasks")).toHaveCount(0);
    await panel.getByRole("button", { name: /Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Waiting" }).click();
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Panel change"))?.status)
      .toBe("WAITING");
    await page.keyboard.press("Escape");
    await page.goto(`/canvases/${id}`);
    await expect(column(page, "Waiting").getByText("Panel change")).toBeVisible();
  });
});

test.describe("Today", () => {
  test("lists an In progress sticky in its own section with its board, and checking it off moves it to Completed", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "In progress", "Do it today");
    await addSticky(page, "Planned", "Not yet");
    await closeAdd(page, "Planned");

    await page.goto("/today");
    const section = page.getByRole("region", { name: /Sticky notes/ });
    await expect(section.getByRole("button", { name: "Do it today" })).toBeVisible();
    await expect(section.getByText("Not yet")).toHaveCount(0);
    await expect(section.getByRole("link", { name: /Untitled board/ })).toBeVisible();

    await section.getByRole("checkbox", { name: "Complete Do it today" }).click();
    const columns = (await boardOf(id))!.board_json.columns;
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Do it today"))?.status)
      .toBe("DONE");
    expect((await stickyByTitle(user.id, "Do it today"))!.board_column_id).toBe(
      columns.find((c) => c.name === "Completed")!.id,
    );
    await page.goto(`/canvases/${id}`);
    await expect(column(page, "Completed").getByText("Do it today")).toBeVisible();
  });
});

test.describe("columns", () => {
  test("rename, add and delete a column moving its stickies, and change a status after the confirmation", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "Planned", "Wanders");
    await closeAdd(page, "Planned");

    // Rename.
    await page.getByRole("button", { name: "Column options for Waiting" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const name = page.getByLabel("Column name");
    await name.fill("Blocked");
    await name.press("Enter");
    await expect(page.getByRole("heading", { name: "Blocked" })).toBeVisible();
    await expect
      .poll(async () => (await boardOf(id))!.board_json.columns.map((c) => c.name))
      .toContain("Blocked");

    // Add.
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByLabel("New column name").fill("Later");
    await page.getByRole("button", { name: "Add column" }).last().click();
    await expect(page.getByRole("heading", { name: "Later" })).toBeVisible();

    // Change a status: asks first.
    await page.getByRole("button", { name: "Column options for Planned" }).click();
    await page.getByRole("menuitem", { name: "Waiting", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 sticky note will become Waiting");
    await dialog.getByRole("button", { name: "Change status" }).click();
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Wanders"))?.status)
      .toBe("WAITING");

    // Delete a column and move its stickies.
    await page.getByRole("button", { name: "Column options for Planned" }).click();
    await page.getByRole("menuitem", { name: "Delete column" }).click();
    const del = page.getByRole("dialog");
    await del.getByLabel("Move them to").selectOption({ label: "Completed (Done)" });
    await expect(del).toContainText("They will become Done");
    await del.getByRole("button", { name: "Delete column" }).click();
    await expect(page.getByRole("heading", { name: "Planned" })).toHaveCount(0);
    await expect(column(page, "Completed").getByText("Wanders")).toBeVisible();
    await expect.poll(async () => (await stickyByTitle(user.id, "Wanders"))?.status).toBe("DONE");
  });
});

test.describe("details, regular tasks, conflicts and Trash", () => {
  test("a due date shows as a chip, and Make it a regular task moves it to Tasks", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "Planned", "Becomes a task");
    await closeAdd(page, "Planned");
    const sticky = (await stickyByTitle(user.id, "Becomes a task"))!;
    await setStickyDue(sticky.id, "2030-01-15");
    await page.reload();
    await expect(column(page, "Planned").getByText(/Due .*15/)).toBeVisible();

    await menuOf(page, "Becomes a task");
    await page.getByRole("menuitem", { name: "Make it a regular task" }).click();
    await expect(column(page, "Planned").getByText("Becomes a task")).toHaveCount(0);
    await expect
      .poll(async () => (await stickyByTitle(user.id, "Becomes a task"))?.kind)
      .toBe("TASK");
    await page.goto("/tasks");
    await expect(page.getByText("Becomes a task")).toBeVisible();
    expect(id).toBeTruthy();
  });

  test("a stale column save shows the conflict banner; Load latest takes the other window's names", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    const id = await newBoard(page);
    await saveBoardElsewhere(id, "Backlog");
    await page.getByRole("button", { name: "Column options for Waiting" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Column name").fill("Parked");
    await page.getByLabel("Column name").press("Enter");
    await expect(page.getByText("This board changed in another window.")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
  });

  test("a deleted sticky can be undone, is found in search labelled Sticky note, and a board in Trash hides its stickies", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await newBoard(page);
    await addSticky(page, "Planned", "Searchable sticky");
    await closeAdd(page, "Planned");

    await page.goto(`/search?q=Searchable`);
    const hit = page.getByRole("link", { name: /Searchable sticky/ }).first();
    await expect(hit).toBeVisible();
    await expect(page.getByText("Sticky note").first()).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/canvases/${id}`));

    await menuOf(page, "Searchable sticky");
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(column(page, "Planned").getByText("Searchable sticky")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(column(page, "Planned").getByText("Searchable sticky")).toBeVisible();
    expect((await stickyByTitle(user.id, "Searchable sticky"))!.deleted_at).toBeNull();

    // Moving the board to Trash hides its stickies in search too.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/canvases$/);
    await page.goto(`/search?q=Searchable`);
    await expect(page.getByRole("link", { name: /Searchable sticky/ })).toHaveCount(0);
  });
});

test.describe("phone and accessibility", () => {
  test("at 360px the columns are tabs with counts, Move to works, and axe finds nothing serious in light and dark", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    await newBoard(page);
    await addSticky(page, "Planned", "Phone note");
    await closeAdd(page, "Planned");
    await insertCanvas(user.id, { title: "x" }); // keeps the list non-empty for the sidebar

    await page.setViewportSize({ width: 360, height: 740 });
    await page.reload();
    const tabs = page.getByRole("navigation", { name: "Columns" });
    await expect(tabs.getByRole("button", { name: /Planned/ })).toContainText("1");
    await expect(column(page, "Planned").getByText("Phone note")).toBeVisible();
    await expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await tabs.getByRole("button", { name: /Waiting/ }).click();
    await expect(column(page, "Waiting")).toBeVisible();
    await tabs.getByRole("button", { name: /Planned/ }).click();
    await menuOf(page, "Phone note");
    await page.getByRole("menuitem", { name: "Waiting", exact: true }).click();
    await expect(tabs.getByRole("button", { name: /Waiting/ })).toContainText("1");

    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.reload();
        await expect(page.getByRole("heading", { name: "Planned" })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const serious = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          serious.map((v) => `${width} ${scheme}: ${v.id}`),
          JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
        ).toEqual([]);
      }
    }
  });

  test("Today's sticky section has no serious accessibility problems, light and dark", async ({
    page,
  }) => {
    test.slow();
    await newUser(page);
    await newBoard(page);
    await addSticky(page, "In progress", "Axe sticky");
    await closeAdd(page, "In progress");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/today");
      await expect(page.getByRole("button", { name: "Axe sticky" })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${scheme}: ${v.id}`),
        JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
      ).toEqual([]);
    }
  });
});
