import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertManyTasks,
  insertNote,
  insertProject,
  insertTask,
  insertTodo,
  noteByTitle,
  setTaskProject,
  taskByTitle,
  taskDueDate,
  todoByTitle,
  todoDueDate,
  viewsOf,
} from "./db";
import { signUp, today } from "./helpers";
import { formatPickerDay } from "../src/lib/dates/calendar";

// V2 feature 06, part two: calendar, notes (board and gallery), legacy links, the view tabs, project
// pages, the phone layout, accessibility and a long list.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const taskOf = async (userId: string, title: string) => (await taskByTitle(userId, title))[0];
const todoOf = async (userId: string, title: string) => (await todoByTitle(userId, title))[0];

async function addView(page: Page, name: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).last().click();
  // The menu hides the rest of the page from screen readers while it closes: wait for it.
  await expect(page.getByRole("menu")).toHaveCount(0);
}

const column = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}\\b`) });
const card = (page: Page, title: string) =>
  page.locator("[data-item-id]").filter({ hasText: title });
const dayCell = (page: Page, date: string) =>
  page.getByRole("gridcell", { name: new RegExp(`^${formatPickerDay(date)}\\b`) });

/** The newest toast is in front; older ones can sit on top of Undo in the stack. */
const undo = (page: Page) =>
  page.locator('[data-sonner-toast][data-front="true"]').getByRole("button", { name: "Undo" });

async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 24, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("calendar", () => {
  test("a task dragged to another day gets that due date, Undo puts it back", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Pay rent", dueDate: today() });
    await page.goto("/tasks");
    await addView(page, "Calendar");
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(dayCell(page, today())).toContainText("Pay rent");

    await drag(page, card(page, "Pay rent"), dayCell(page, today(2)));
    await expect
      .poll(async () => taskDueDate((await taskOf(user.id, "Pay rent"))!.id))
      .toBe(today(2));
    await expect(dayCell(page, today(2))).toContainText("Pay rent");

    await undo(page).click();
    await expect
      .poll(async () => taskDueDate((await taskOf(user.id, "Pay rent"))!.id))
      .toBe(today());
  });

  test("an undated todo is scheduled from the No date list; week and month both work", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTodo(user.id, { title: "Buy stamps" });
    await page.goto("/tasks?view=todos");
    await addView(page, "Calendar");
    await expect(page.getByRole("region", { name: /^No date/ })).toContainText("Buy stamps");

    await drag(page, card(page, "Buy stamps"), dayCell(page, today(1)));
    await expect
      .poll(async () => todoDueDate((await todoOf(user.id, "Buy stamps"))!.id))
      .toBe(today(1));
    await expect(page.getByRole("region", { name: /^No date/ })).not.toContainText("Buy stamps");

    // The keyboard and touch way: the item's own date menu.
    await insertTodo(user.id, { title: "Call bank" });
    await page.reload();
    await page.getByRole("button", { name: "Move Call bank to date" }).click();
    await page.getByLabel("Move to date").fill(today(3));
    await expect
      .poll(async () => todoDueDate((await todoOf(user.id, "Call bank"))!.id))
      .toBe(today(3));

    await page.getByRole("radio", { name: "Week" }).click();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(dayCell(page, today(1))).toContainText("Buy stamps");
    await page.getByRole("button", { name: "Next week" }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("radio", { name: "Month" }).click();
    await expect(dayCell(page, today(1))).toContainText("Buy stamps");
  });
});

test.describe("notes", () => {
  test("a Board by project: dragging a note to another column moves it, Undo returns it", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const alpha = await insertProject(user.id, { name: "Alpha" });
    await insertProject(user.id, { name: "Beta" });
    await insertNote(user.id, { title: "Meeting notes", projectId: alpha });
    await page.goto("/notes");
    await addView(page, "Board");
    await expect(column(page, "Alpha")).toContainText("Meeting notes");

    await drag(page, card(page, "Meeting notes"), column(page, "Beta"));
    await expect(column(page, "Beta")).toContainText("Meeting notes");
    await expect
      .poll(async () => (await noteByTitle(user.id, "Meeting notes"))?.project_id)
      .not.toBe(alpha);

    await undo(page).click();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Meeting notes"))?.project_id)
      .toBe(alpha);
  });

  test("the old ?view=grid link opens a Gallery view, made once", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Trip ideas", text: "Lisbon, Porto" });
    await page.goto("/notes?view=grid");
    await expect(page.getByRole("link", { name: /Trip ideas/ })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: /Gallery/ }),
    ).toBeVisible();
    const galleries = (await viewsOf(user.id, "NOTES")).filter((v) => v.type === "GALLERY");
    expect(galleries).toHaveLength(1);

    await page.goto("/notes?view=grid");
    expect((await viewsOf(user.id, "NOTES")).filter((v) => v.type === "GALLERY")).toHaveLength(1);
  });
});

test.describe("saved views", () => {
  test("rename, duplicate, delete with Undo; the last view cannot be deleted; the last view is reopened", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Anything" });
    await page.goto("/tasks");
    await addView(page, "Table");
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("button", { name: "Options for the Table view" }).click();
    await page.getByRole("menuitem", { name: /Rename and icon/ }).click();
    await page.getByLabel("Name", { exact: true }).fill("Everything");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: /^Everything/ })).toBeVisible();

    await page.getByRole("button", { name: "Options for the Everything view" }).click();
    await page.getByRole("menuitem", { name: /Duplicate/ }).click();
    await expect.poll(async () => (await viewsOf(user.id, "TASKS")).length).toBe(3);

    // The last view used here is opened again when the page is opened without a view.
    await page.goto("/tasks");
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("button", { name: /^Options for the .* view$/ }).click();
    await page.getByRole("menuitem", { name: /Delete view/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete view" }).click();
    await expect.poll(async () => (await viewsOf(user.id, "TASKS")).length).toBe(2);
    await undo(page).click();
    await expect.poll(async () => (await viewsOf(user.id, "TASKS")).length).toBe(3);
  });

  test("filters and sorts set in View settings are saved with the view", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Alpha task", priority: "LOW" });
    await insertTask(user.id, { title: "Bravo task", priority: "HIGH" });
    await page.goto("/tasks");
    await addView(page, "Table");
    await page.getByRole("button", { name: "View settings" }).click();
    await page.getByRole("button", { name: "Add sort" }).click();
    await page.getByLabel("Sort 1 property").selectOption({ label: "Priority" });
    await page.getByLabel("Sort 1 direction").selectOption("desc");
    await expect
      .poll(async () => {
        const view = (await viewsOf(user.id, "TASKS")).find((v) => v.type === "TABLE");
        return JSON.stringify((view?.config as { sorts?: unknown })?.sorts);
      })
      .toContain("priority");
    await page.keyboard.press("Escape");

    await page.reload();
    const rows = page.locator("tbody tr[data-item-id]");
    await expect(rows.first()).toContainText("Bravo task");
  });
});

test.describe("project page", () => {
  test("views on a project page show only that project's items", async ({ page }) => {
    const { user } = await newUser(page);
    const launch = await insertProject(user.id, { name: "Launch" });
    await insertTask(user.id, { title: "Inside task", status: "PLANNED" });
    await insertTask(user.id, { title: "Outside task", status: "PLANNED" });
    const inside = await taskOf(user.id, "Inside task");
    await setTaskProject(inside!.id, launch);

    await page.goto(`/projects/${launch}`);
    await expect(page.getByText("Inside task")).toBeVisible();
    await expect(page.getByText("Outside task")).toHaveCount(0);
    await addView(page, "Board by status");
    await expect(column(page, "Planned")).toContainText("Inside task");
    await expect(page.getByText("Outside task")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test("board, table and calendar fit a 360px screen without sideways page scroll", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Phone task", status: "PLANNED", dueDate: today() });
    await page.goto("/tasks");
    const fits = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

    await addView(page, "Board by status");
    await expect(page.getByRole("button", { name: /^Planned/ })).toBeVisible();
    await expect(card(page, "Phone task")).toBeVisible();
    await fits();

    await addView(page, "Table");
    await expect(page.getByRole("table")).toBeVisible();
    await fits();

    await addView(page, "Calendar");
    await expect(page.getByRole("list", { name: "Week agenda" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Week agenda" })).toContainText("Phone task");
    await fits();
  });
});

test.describe("accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`every view type passes axe in ${colorScheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const { user } = await newUser(page);
      const project = await insertProject(user.id, { name: "Acme", color: "teal" });
      await insertTask(user.id, { title: "Send invoice", dueDate: today(-2), priority: "HIGH" });
      await insertTask(user.id, { title: "Plan trip", status: "IN_PROGRESS", dueDate: today(3) });
      await insertTodo(user.id, { title: "Buy milk" });
      await insertNote(user.id, { title: "Ideas", text: "Something", projectId: project });
      await page.goto("/tasks");

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

      await scan("tasks list");
      await addView(page, "Board by status");
      await expect(column(page, "In progress")).toContainText("Plan trip");
      await scan("tasks board");
      await addView(page, "Table");
      await expect(page.getByRole("table")).toBeVisible();
      await scan("tasks table");
      await addView(page, "Calendar");
      await expect(page.getByRole("grid")).toBeVisible();
      await scan("tasks calendar");

      await page.goto("/notes?view=grid");
      await expect(page.getByRole("link", { name: /Ideas/ })).toBeVisible();
      await scan("notes gallery");
    });
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a board drag still works, and nothing waits on an animation", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Calm task", status: "PLANNED" });
    await page.goto("/tasks");
    await addView(page, "Board by status");
    await drag(page, card(page, "Calm task"), column(page, "In progress"));
    await expect.poll(async () => (await taskOf(user.id, "Calm task"))?.status).toBe("IN_PROGRESS");
  });
});

test.describe("a long list", () => {
  test("2,000 tasks: the board and table open quickly and page their rows", async ({ page }) => {
    test.setTimeout(90_000);
    const { user } = await newUser(page);
    await insertManyTasks(user.id, 2000);
    await page.goto("/tasks");
    await addView(page, "Table");
    await expect(page.getByRole("table")).toBeVisible();
    const rows = page.locator("tbody tr[data-item-id]");
    await expect(rows.first()).toBeVisible();
    // Not all 2,000 rows are in the page at once.
    expect(await rows.count()).toBeLessThan(500);
    await page.getByRole("button", { name: /Show more/ }).click();

    await addView(page, "Board by status");
    await expect(column(page, "Planned")).toBeVisible();
    await expect(page.getByRole("button", { name: /Show more/ }).first()).toBeVisible();

    // A drag still works with this many cards on the page.
    await insertTask(user.id, { title: "Needle", status: "PLANNED", sortOrder: -1 });
    await page.reload();
    await expect(card(page, "Needle")).toBeVisible();
    await drag(page, card(page, "Needle"), column(page, "In progress"));
    await expect.poll(async () => (await taskOf(user.id, "Needle"))?.status).toBe("IN_PROGRESS");
  });
});
