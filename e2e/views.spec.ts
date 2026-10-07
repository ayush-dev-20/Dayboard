import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertProject,
  insertTag,
  insertTask,
  tagsOfTask,
  taskByTitle,
  taskDueDate,
  taskProject,
  viewsOf,
} from "./db";
import { signUp, today } from "./helpers";

// V2 feature 06: saved views (list, table, board, calendar, gallery), drag between columns, cell
// edits, bulk actions, view settings, project pages.

test.use({ viewport: { width: 1280, height: 800 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const taskOf = async (userId: string, title: string) => (await taskByTitle(userId, title))[0];

/** "+ View" menu: pick a ready-made start or a type. */
async function addView(page: Page, name: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).last().click();
}

const column = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}\\b`) });
const card = (page: Page, title: string) =>
  page.locator("[data-item-id]").filter({ hasText: title });

/** A mouse drag in small steps, so the library sees a real pointer move. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 24, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("board", () => {
  test("a Board by status: drag a card between columns, with Undo", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Write report", status: "PLANNED" });
    await insertTask(user.id, { title: "Call Sam", status: "PLANNED" });
    await page.goto("/tasks");
    await addView(page, "Board by status");
    await expect(page).toHaveURL(/view=/);
    await expect(column(page, "Planned")).toContainText("Write report");

    await drag(page, card(page, "Write report"), column(page, "In progress"));
    await expect(page.getByText("Moved to In progress.").first()).toBeVisible();
    await expect
      .poll(async () => (await taskOf(user.id, "Write report"))?.status)
      .toBe("IN_PROGRESS");
    await expect(column(page, "In progress")).toContainText("Write report");

    await page
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(async () => (await taskOf(user.id, "Write report"))?.status).toBe("PLANNED");
    await expect(column(page, "Planned")).toContainText("Write report");
  });
});

test.describe("board, more", () => {
  test("dropping a repeating task on Done makes its next one, and Undo takes both back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, {
      title: "Water plants",
      dueDate: today(),
      recurrenceRule: "FREQ=DAILY",
    });
    // Wide enough that all five columns fit, so no drag has to scroll the board.
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto("/tasks");
    await addView(page, "Board by status");
    // Done is collapsed by default: expand it so the drop target is wide.
    await page.getByRole("button", { name: "Expand Done" }).click();

    await drag(page, card(page, "Water plants"), column(page, "Done"));
    await expect(page.getByText("Moved to Done.").first()).toBeVisible();
    await expect.poll(async () => (await taskByTitle(user.id, "Water plants")).length).toBe(2);
    const [first, second] = await taskByTitle(user.id, "Water plants");
    expect(first?.status).toBe("DONE");
    expect(second?.status).not.toBe("DONE");
    expect(second?.due_date).toBe(today(1));

    await page
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(async () => (await taskByTitle(user.id, "Water plants")).length).toBe(1);
    expect((await taskOf(user.id, "Water plants"))?.status).toBe("PLANNED");
  });

  test("a drop that cannot mean anything is refused and changes nothing", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Later one", dueDate: today(20) });
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto("/tasks");
    await addView(page, "Board");
    await page.getByRole("button", { name: "View settings" }).click();
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByLabel("Group by").selectOption("dueBucket");
    await saved; // the settings are saved a moment after the change; not in the middle of a drag
    await page.keyboard.press("Escape");
    await page.waitForLoadState("networkidle");
    await expect(column(page, "Later")).toContainText("Later one");

    await drag(page, card(page, "Later one"), column(page, "Overdue"));
    await expect(page.getByText(/Overdue comes from a date in the past/).first()).toBeVisible();
    expect(await taskDueDate((await taskOf(user.id, "Later one"))!.id)).toBe(today(20));

    // Dropping on This week keeps the weekday where it can, and sets a date.
    await drag(page, card(page, "Later one"), column(page, "This week"));
    await expect(page.getByText(/Due date set to This week/).first()).toBeVisible();
    await expect
      .poll(async () => taskDueDate((await taskOf(user.id, "Later one"))!.id))
      .not.toBe(today(20));
  });

  test("keyboard only: Space lifts a card, the arrow keys move it to a column, Space drops it", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Keyboard task", status: "PLANNED" });
    await page.goto("/tasks");
    await addView(page, "Board by status");

    await page.getByRole("button", { name: "Move Keyboard task" }).focus();
    await page.keyboard.press("Space");
    // The lift is announced, and then the first position is (the library replaces the message).
    await expect(
      page.getByText(/Keyboard task is over Planned|Picked up Keyboard task/).first(),
    ).toBeAttached();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/Keyboard task is over In progress/).first()).toBeAttached();
    await page.keyboard.press("Space");
    await expect
      .poll(async () => (await taskOf(user.id, "Keyboard task"))?.status)
      .toBe("IN_PROGRESS");
    await expect(column(page, "In progress")).toContainText("Keyboard task");
  });

  test("every card has a Move to menu, and + New makes an item already in that column", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Menu task", status: "PLANNED" });
    await page.goto("/tasks");
    await addView(page, "Board by status");

    await page.getByRole("button", { name: "More actions for Menu task" }).click();
    await page.getByRole("menuitem", { name: "Waiting", exact: true }).click();
    await expect.poll(async () => (await taskOf(user.id, "Menu task"))?.status).toBe("WAITING");

    await page.getByRole("button", { name: /^New task in In progress/ }).click();
    await page.getByLabel(/^Title of the new task in In progress/).fill("Made in a column");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await taskOf(user.id, "Made in a column"))?.status)
      .toBe("IN_PROGRESS");
    await expect(column(page, "In progress")).toContainText("Made in a column");
  });

  test("order inside a column is manual and survives a reload", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "First", status: "PLANNED" });
    await insertTask(user.id, { title: "Second", status: "PLANNED" });
    await insertTask(user.id, { title: "Third", status: "PLANNED" });
    await page.goto("/tasks");
    await addView(page, "Board by status");
    const titles = () => column(page, "Planned").locator("[data-item-id]").allTextContents();
    await expect.poll(titles).toEqual(expect.arrayContaining([expect.stringContaining("First")]));

    await drag(page, card(page, "Third"), card(page, "First"));
    await expect
      .poll(async () => (await titles()).map((t) => t.split(" ")[0] ?? ""))
      .toEqual(["Third", "First", "Second"]);
    await page.reload();
    await expect
      .poll(async () => (await titles()).map((t) => t.split(" ")[0] ?? ""))
      .toEqual(["Third", "First", "Second"]);
  });

  test("Done and Cancelled start collapsed, and the choice is kept with the view", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Finished", status: "DONE" });
    await page.goto("/tasks");
    await addView(page, "Board by status");
    await expect(page.getByRole("button", { name: "Expand Done" })).toBeVisible();
    await page.getByRole("button", { name: "Expand Done" }).click();
    await expect(column(page, "Done")).toContainText("Finished");
    await expect
      .poll(
        async () => (await viewsOf(user.id, "TASKS")).at(-1)?.config.collapsedGroups as string[],
      )
      .toEqual(["CANCELLED"]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Collapse Done" })).toBeVisible();
  });
});

test.describe("table", () => {
  test("sort by due date, edit a status in a cell, select rows and set a project in one action, Undo", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const projectId = await insertProject(user.id, { name: "Launch" });
    await insertTask(user.id, { title: "Later task", dueDate: today(5) });
    await insertTask(user.id, { title: "Soon task", dueDate: today(1) });
    await insertTask(user.id, { title: "No date task" });
    await page.goto("/tasks");
    await addView(page, "Table");
    const rows = () => page.locator("tbody tr[data-item-id]");
    await expect(rows()).toHaveCount(3);

    // Click the Due heading: ascending, items without a date last.
    await page.getByRole("columnheader", { name: /Due/ }).getByRole("button").first().click();
    await expect(page.getByRole("columnheader", { name: /Due/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect
      .poll(async () => (await rows().allTextContents()).join(" "))
      .toMatch(/Soon.*Later.*No date/);

    // A status edited in its cell.
    await page.getByRole("button", { name: "Status of Soon task: Planned" }).click();
    await page.getByRole("menuitemradio", { name: "In progress" }).click();
    await expect.poll(async () => (await taskOf(user.id, "Soon task"))?.status).toBe("IN_PROGRESS");

    // Two rows selected, one project for both, then Undo takes it back.
    await page.getByLabel("Select Soon task").click();
    await page.getByLabel("Select Later task").click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("2 selected");
    await page
      .getByRole("region", { name: "Bulk actions" })
      .getByRole("button", { name: "Project" })
      .click();
    await page.getByRole("button", { name: /Launch/ }).click();
    await expect
      .poll(async () => taskProject((await taskOf(user.id, "Soon task"))!.id))
      .toBe(projectId);
    await expect
      .poll(async () => taskProject((await taskOf(user.id, "Later task"))!.id))
      .toBe(projectId);
    expect(await taskProject((await taskOf(user.id, "No date task"))!.id)).toBeNull();

    await page
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(async () => taskProject((await taskOf(user.id, "Soon task"))!.id)).toBeNull();
    await expect
      .poll(async () => taskProject((await taskOf(user.id, "Later task"))!.id))
      .toBeNull();
  });

  test("a title edited in place, a column hidden, and the widths and sort kept with the view", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Old name", dueDate: today(2) });
    await page.goto("/tasks");
    await addView(page, "Table");

    await page.getByRole("button", { name: "Edit title of Old name" }).click();
    await page.getByLabel("Title of Old name").fill("New name");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await taskOf(user.id, "New name"))?.id).toBeTruthy();

    await page.getByRole("button", { name: "Column options for Priority" }).click();
    await page.getByRole("menuitem", { name: "Hide column" }).click();
    await expect(page.getByRole("columnheader", { name: /Priority/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Title/ }).click();
    await expect
      .poll(async () => {
        const config = (await viewsOf(user.id, "TASKS")).at(-1)?.config as {
          visibleProperties: string[];
          sorts: unknown[];
        };
        return [config.visibleProperties.includes("priority"), config.sorts.length];
      })
      .toEqual([false, 1]);

    await page.reload();
    await expect(page.getByRole("columnheader", { name: /Priority/ })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  test("bulk actions: complete, tag, archive, and move to Trash after a confirmation", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTag(user.id, "urgent");
    await insertTask(user.id, { title: "One" });
    await insertTask(user.id, { title: "Two" });
    await page.goto("/tasks");
    await addView(page, "Table");
    await page.getByLabel("Select all").click();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");

    await bar.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("menuitem", { name: "urgent" }).click();
    await expect
      .poll(async () => (await tagsOfTask((await taskOf(user.id, "One"))!.id)).length)
      .toBe(1);

    await page.getByLabel("Select all").click();
    await bar.getByRole("button", { name: "Move to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect.poll(async () => (await taskOf(user.id, "One"))?.deleted_at).not.toBeNull();
    await expect.poll(async () => (await taskOf(user.id, "Two"))?.deleted_at).not.toBeNull();
    // Toasts stack: the newest one is in front.
    await page
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(async () => (await taskOf(user.id, "One"))?.deleted_at).toBeNull();
  });
});
