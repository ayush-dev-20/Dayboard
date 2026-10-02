import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertTask, taskByTitle } from "./db";
import { addTask, chipFor, detailPanel, openTask, signUp, taskRow, today } from "./helpers";

async function newUser(page: import("@playwright/test").Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  return { account, user };
}

test.describe("creating, editing and completing", () => {
  test("create a task, edit it, complete it, undo, complete again, and it persists", async ({
    page,
  }) => {
    test.slow(); // a long journey: each Undo toast alone takes five seconds to close
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await expect(page.getByText("No tasks yet.")).toBeVisible();

    await addTask(page, "Write report");
    await expect(page.getByText("No tasks yet.")).toHaveCount(0);
    await expect(page.getByText("1 open")).toBeVisible();

    // Edit in the side sheet: title, priority and due date.
    await openTask(page, "Write report");
    const sheet = detailPanel(page);
    await expect(page).toHaveURL(/\/tasks\?task=/);
    await sheet.getByLabel("Task title").fill("Write quarterly report");
    await sheet.getByLabel("Task title").blur();
    await expect(taskRow(page, "Write quarterly report")).toBeVisible();

    await sheet.getByRole("button", { name: /^Priority/ }).click();
    await page.getByRole("menuitemradio", { name: "High" }).click();
    await expect(sheet.getByRole("button", { name: /^Priority/ })).toContainText("High");

    await sheet.getByRole("button", { name: /^Due/ }).click();
    await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(sheet.getByRole("button", { name: /^Due/ })).not.toContainText("None");

    const [saved] = await taskByTitle(user.id, "Write quarterly report");
    expect(saved).toMatchObject({ priority: "HIGH", due_date: today(1) });
    await expect(
      taskRow(page, "Write quarterly report").getByRole("img", { name: "Priority: High" }),
    ).toBeVisible();
    await expect(taskRow(page, "Write quarterly report")).toContainText(chipFor(1));

    await page.keyboard.press("Escape");
    await expect(detailPanel(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);

    // Complete: the box fills at once and the row stays where it is while Undo is offered.
    const row = taskRow(page, "Write quarterly report");
    const checkbox = row.getByRole("checkbox");
    const before = await row.boundingBox();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByText("Task completed.")).toBeVisible();
    expect(await row.boundingBox()).toEqual(before);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(checkbox).not.toBeChecked();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Write quarterly report"))[0]?.status)
      .toBe("PLANNED");

    // Complete again and let the toast close: the row moves to Completed.
    await checkbox.click();
    await expect(page.getByText("Task completed.")).toBeVisible();
    await expect(page.getByText("Task completed.")).toHaveCount(0, { timeout: 12_000 });
    await expect(taskRow(page, "Write quarterly report")).toHaveCount(0);

    await page.reload();
    await expect(taskRow(page, "Write quarterly report")).toHaveCount(0);
    const completed = page.getByRole("button", { name: /Completed/ });
    await expect(completed).toContainText("1");
    await completed.click();
    await expect(taskRow(page, "Write quarterly report").getByRole("checkbox")).toBeChecked();
    expect((await taskByTitle(user.id, "Write quarterly report"))[0]).toMatchObject({
      status: "DONE",
    });

    // Reopen from the Completed list.
    await taskRow(page, "Write quarterly report").getByRole("checkbox").click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Write quarterly report"))[0]?.status)
      .toBe("PLANNED");
  });

  test("an invalid title is refused and the old one comes back", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Keep this name");
    await openTask(page, "Keep this name");

    const title = detailPanel(page).getByLabel("Task title");
    await title.fill("   ");
    await title.blur();
    await expect(page.getByText("Enter a title.")).toBeVisible();
    await expect(title).toHaveValue("Keep this name");
  });

  test("adding a task by pressing Enter keeps focus for the next one", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    const add = page.getByLabel("Add task", { exact: true });

    await add.fill("First");
    await page.keyboard.press("Enter");
    await expect(taskRow(page, "First")).toBeVisible();
    await expect(add).toBeFocused();
    await expect(add).toHaveValue("");

    await page.keyboard.type("Second");
    await page.keyboard.press("Enter");
    await expect(taskRow(page, "Second")).toBeVisible();

    // Newest first, in the person's own order.
    const titles = await page.locator("[data-task-id] [data-row-focus]").allTextContents();
    expect(titles).toEqual(["Second", "First"]);
  });

  test("status can be changed from the detail, and finishing from there offers Undo", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Status task");
    await openTask(page, "Status task");
    const sheet = detailPanel(page);

    await sheet.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Waiting" }).click();
    await expect(sheet.getByRole("button", { name: /^Status/ })).toContainText("Waiting");
    await expect
      .poll(async () => (await taskByTitle(user.id, "Status task"))[0]?.status)
      .toBe("WAITING");

    await sheet.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Done" }).click();
    await expect(page.getByText("Task completed.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Status task"))[0]?.status)
      .toBe("WAITING");
  });

  test("changes made in the detail survive a reload", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Persistent");
    await openTask(page, "Persistent");
    const sheet = detailPanel(page);

    await sheet.getByRole("button", { name: /^Priority/ }).click();
    await page.getByRole("menuitemradio", { name: "Medium" }).click();
    await expect(sheet.getByRole("button", { name: /^Priority/ })).toContainText("Medium");
    await sheet.getByRole("button", { name: /^Due/ }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(sheet.getByRole("button", { name: /^Due/ })).not.toContainText("None");
    await sheet.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "In progress" }).click();
    await expect(sheet.getByRole("button", { name: /^Status/ })).toContainText("In progress");

    await page.reload();
    const again = detailPanel(page);
    await expect(again.getByRole("button", { name: /^Priority/ })).toContainText("Medium");
    await expect(again.getByRole("button", { name: /^Status/ })).toContainText("In progress");
    await expect(again.getByRole("button", { name: /^Due/ })).not.toContainText("None");
  });
});

test.describe("subtasks", () => {
  test("add two, complete one, and the count reads 1/2", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Parent task");
    await openTask(page, "Parent task");
    const sheet = detailPanel(page);

    const add = sheet.getByLabel("Add subtask");
    await add.fill("Step one");
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("button", { name: "Step one", exact: true })).toBeVisible();
    await page.keyboard.type("Step two");
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("button", { name: "Step two", exact: true })).toBeVisible();

    await sheet.getByRole("checkbox", { name: "Complete Step one" }).click();
    await expect(sheet.getByRole("checkbox", { name: "Reopen Step one" })).toBeChecked();
    await expect(taskRow(page, "Parent task")).toContainText("1/2");

    const [parent] = await taskByTitle(user.id, "Parent task");
    const [one] = await taskByTitle(user.id, "Step one");
    expect(one).toMatchObject({ status: "DONE", parent_task_id: parent!.id });
  });

  test("a subtask can be renamed and moved to Trash with Undo", async ({ page }) => {
    const { user } = await newUser(page);
    const parentId = await insertTask(user.id, { title: "Has subtasks" });
    await insertTask(user.id, { title: "Old name", parentTaskId: parentId, sortOrder: 1 });
    await page.goto(`/tasks?task=${parentId}`);
    const sheet = detailPanel(page);

    await sheet.getByRole("button", { name: "Old name", exact: true }).click();
    await sheet.getByLabel("Subtask title").fill("New name");
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("button", { name: "New name", exact: true })).toBeVisible();
    await expect.poll(async () => (await taskByTitle(user.id, "New name")).length).toBe(1);

    await sheet.getByRole("button", { name: "More actions for New name" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(sheet.getByRole("button", { name: "New name", exact: true })).toHaveCount(0);
    await expect
      .poll(async () => (await taskByTitle(user.id, "New name"))[0]?.deleted_at ?? null)
      .not.toBeNull();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(sheet.getByRole("button", { name: "New name", exact: true })).toBeVisible();
    await expect
      .poll(async () => (await taskByTitle(user.id, "New name"))[0]?.deleted_at ?? null)
      .toBeNull();
  });

  test("there is no way to add a subtask to a subtask", async ({ page }) => {
    const { user } = await newUser(page);
    const parentId = await insertTask(user.id, { title: "Top" });
    const subId = await insertTask(user.id, { title: "Inner", parentTaskId: parentId });
    await page.goto(`/tasks/${subId}`);
    await expect(page.getByLabel("Task title")).toHaveValue("Inner");
    await expect(page.getByLabel("Add subtask")).toHaveCount(0);
  });
});

test.describe("repeating tasks", () => {
  test("a daily task rolls to tomorrow when completed", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Water plants");
    await openTask(page, "Water plants");
    const sheet = detailPanel(page);

    // A repeat needs a due date: the menu says so until there is one.
    await sheet.getByRole("button", { name: /^Repeat/ }).click();
    await expect(page.getByText("Choose a due date first")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Daily" })).toBeDisabled();
    await page.keyboard.press("Escape");

    await sheet.getByRole("button", { name: /^Due/ }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.keyboard.press("Escape");

    await sheet.getByRole("button", { name: /^Repeat/ }).click();
    await page.getByRole("radio", { name: "Daily" }).click();
    await expect(sheet.getByRole("button", { name: /^Repeat/ })).toContainText("Daily");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await taskRow(page, "Water plants").getByRole("checkbox").click();
    await expect(page.getByText("Task completed. The next one is ready.")).toBeVisible();
    await expect(page.getByText("Task completed. The next one is ready.")).toHaveCount(0, {
      timeout: 12_000,
    });

    // The next occurrence is dated tomorrow and still repeats; the finished one is a plain task.
    await expect(taskRow(page, "Water plants")).toHaveCount(1);
    await expect(taskRow(page, "Water plants")).toContainText(chipFor(1));
    const rows = await taskByTitle(user.id, "Water plants");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === "DONE")).toMatchObject({
      due_date: today(),
      recurrence_rule: null,
    });
    expect(rows.find((r) => r.status === "PLANNED")).toMatchObject({
      due_date: today(1),
      recurrence_rule: "FREQ=DAILY",
    });
  });

  test("undoing a repeating completion removes the new one and restores the repeat", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Standup", dueDate: today(), recurrenceRule: "FREQ=DAILY" });
    await page.goto("/tasks");

    await taskRow(page, "Standup").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(taskRow(page, "Standup").getByRole("checkbox")).not.toBeChecked();

    await expect.poll(async () => (await taskByTitle(user.id, "Standup")).length).toBe(1);
    expect((await taskByTitle(user.id, "Standup"))[0]).toMatchObject({
      status: "PLANNED",
      due_date: today(),
      recurrence_rule: "FREQ=DAILY",
    });
  });

  test("weekly repeat lets the days be chosen and keeps at least one", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Review", dueDate: today() });
    await page.goto("/tasks");
    await openTask(page, "Review");
    const sheet = detailPanel(page);

    await sheet.getByRole("button", { name: /^Repeat/ }).click();
    await page.getByRole("radio", { name: "Weekly" }).click();
    const days = page.getByRole("group", { name: "Days of the week" });
    await expect(days.getByRole("button", { pressed: true })).toHaveCount(1);

    await days.getByRole("button", { name: "Monday" }).click();
    await days.getByRole("button", { name: "Wednesday" }).click();
    await expect(days.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(days.getByRole("button", { name: "Wednesday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Quick successive taps all land: nothing is overwritten by a slower, older save.
    await expect
      .poll(async () => (await taskByTitle(user.id, "Review"))[0]?.recurrence_rule)
      .toMatch(/^FREQ=WEEKLY;BYDAY=(?=.*MO)(?=.*WE)/);

    // Turning every day off is refused: one stays on.
    for (const day of ["Monday", "Wednesday", "Thursday"])
      await days.getByRole("button", { name: day }).click();
    await expect(days.getByRole("button", { pressed: true })).toHaveCount(1);

    await page.getByRole("radio", { name: "Never" }).click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Review"))[0]?.recurrence_rule)
      .toBeNull();
  });
});

test.describe("description", () => {
  test("rich text survives a reload", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Notes task");
    await openTask(page, "Notes task");
    const sheet = detailPanel(page);

    const editor = sheet.getByRole("textbox", { name: "Task description" });
    await editor.click();
    // Turn bold on from the toolbar, type, turn it off: no text selection needed.
    await sheet.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type("Agenda");
    await sheet.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.press("Enter");
    await sheet.getByRole("button", { name: "Bulleted list" }).click();
    await page.keyboard.type("brand review");
    await page.keyboard.press("Enter");
    await page.keyboard.type("timeline");

    await expect(sheet.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Notes task"))[0]?.description_text)
      .toBe("Agenda\n- brand review\n- timeline");

    await page.reload();
    const again = detailPanel(page).getByRole("textbox", { name: "Task description" });
    await expect(again.locator("strong")).toHaveText("Agenda");
    await expect(again.locator("ul li")).toHaveCount(2);
    await expect(again.locator("ul li").first()).toHaveText("brand review");
  });

  test("a checklist and a link can be added", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Checklist task");
    await openTask(page, "Checklist task");
    const sheet = detailPanel(page);

    const editor = sheet.getByRole("textbox", { name: "Task description" });
    await editor.click();
    await sheet.getByRole("button", { name: "Checklist" }).click();
    await page.keyboard.type("book room");
    await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(1);
    await editor.locator('input[type="checkbox"]').check();
    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(1);
    // The ticked state is what gets saved, not just what is shown.
    await expect
      .poll(async () =>
        JSON.stringify((await taskByTitle(user.id, "Checklist task"))[0]?.description_json),
      )
      .toContain('"checked":true');

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("docs");
    for (let i = 0; i < "docs".length; i++) await page.keyboard.press("Shift+ArrowLeft");
    await sheet.getByRole("button", { name: "Link", exact: true }).click();
    await page.getByLabel("Link address").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(
      page.getByText("Links must start with http://, https:// or mailto:."),
    ).toBeVisible();

    await page.getByLabel("Link address").fill("example.com/docs");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/docs");
    await expect(editor.locator("a")).toHaveAttribute("rel", /noopener/);
  });

  test("text typed while offline is kept and saved when the connection returns", async ({
    page,
    context,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Offline task");
    await openTask(page, "Offline task");
    const sheet = detailPanel(page);
    const editor = sheet.getByRole("textbox", { name: "Task description" });

    await editor.click();
    await context.setOffline(true);
    await page.keyboard.type("written offline");
    await expect(sheet.getByText("Not saved, retrying")).toBeVisible({ timeout: 15_000 });
    await expect(editor).toContainText("written offline");

    await context.setOffline(false);
    await expect(sheet.getByText("Saved")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await taskByTitle(user.id, "Offline task"))[0]?.description_text)
      .toBe("written offline");
  });
});

test.describe("trash, archive and ownership", () => {
  test("deleting a task with subtasks moves them all to Trash, and Undo brings them back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const parentId = await insertTask(user.id, { title: "Doomed" });
    await insertTask(user.id, { title: "Sub one", parentTaskId: parentId, sortOrder: 1 });
    await insertTask(user.id, { title: "Sub two", parentTaskId: parentId, sortOrder: 2 });
    await page.goto("/tasks");
    await expect(taskRow(page, "Doomed")).toContainText("0/2");

    await page.getByRole("button", { name: "More actions for Doomed" }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(taskRow(page, "Doomed")).toHaveCount(0);

    const trashed = [
      (await taskByTitle(user.id, "Doomed"))[0]!,
      (await taskByTitle(user.id, "Sub one"))[0]!,
      (await taskByTitle(user.id, "Sub two"))[0]!,
    ];
    expect(trashed.every((t) => t.deleted_at !== null)).toBe(true);
    expect(new Set(trashed.map((t) => t.deleted_at!.getTime())).size).toBe(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(taskRow(page, "Doomed")).toBeVisible();
    await expect(taskRow(page, "Doomed")).toContainText("0/2");
    await expect
      .poll(async () => (await taskByTitle(user.id, "Sub one"))[0]?.deleted_at ?? null)
      .toBeNull();
  });

  test("deleting from the detail closes it", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Remove from sheet");
    await openTask(page, "Remove from sheet");

    await detailPanel(page).getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(detailPanel(page)).toHaveCount(0);
    await expect(taskRow(page, "Remove from sheet")).toHaveCount(0);
  });

  test("archived tasks leave the list and appear under Show archived", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Archive me" });
    await page.goto("/tasks");

    await page.getByRole("button", { name: "More actions for Archive me" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("Task archived.")).toBeVisible();
    await expect(taskRow(page, "Archive me")).toHaveCount(0);

    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Show archived" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/archived=1/);
    await expect(taskRow(page, "Archive me")).toBeVisible();

    await page.getByRole("button", { name: "More actions for Archive me" }).click();
    await page.getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(taskRow(page, "Archive me")).toHaveCount(0);
    await expect
      .poll(async () => (await taskByTitle(user.id, "Archive me"))[0]?.archived_at ?? null)
      .toBeNull();
  });

  test("someone else's task is simply not found, in the page, the sheet and the list", async ({
    browser,
    page,
  }) => {
    const { user: owner } = await newUser(page);
    const taskId = await insertTask(owner.id, { title: "Alice private", dueDate: today() });

    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.7.7.7" } });
    const otherPage = await other.newPage();
    await signUp(otherPage);

    await otherPage.goto(`/tasks/${taskId}`);
    await expect(otherPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();

    await otherPage.goto(`/tasks?task=${taskId}`);
    await expect(otherPage.getByRole("complementary", { name: "Task detail" })).toHaveCount(0);
    await expect(otherPage.getByText("Alice private")).toHaveCount(0);
    await expect(otherPage.getByText("No tasks yet.")).toBeVisible();

    // The same answer as for an id that doesn't exist at all, and for one that isn't an id.
    await otherPage.goto("/tasks/00000000-0000-7000-8000-000000000000");
    await expect(otherPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await otherPage.goto("/tasks/not-an-id");
    await expect(otherPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await other.close();

    expect((await taskByTitle(owner.id, "Alice private"))[0]).toMatchObject({ status: "PLANNED" });
  });

  test("signed-out visitors are sent to sign in, with the task they wanted remembered", async ({
    page,
  }) => {
    await page.goto("/tasks?task=00000000-0000-7000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftasks%3Ftask%3D/);
    await page.goto("/tasks/00000000-0000-7000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });
});

test.describe("groups, filters and empty states", () => {
  test("open tasks fall into Overdue, Today, Upcoming and No date, and overdue says so in words", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Late invoice", dueDate: today(-3), priority: "HIGH" });
    await insertTask(user.id, { title: "Today thing", dueDate: today() });
    await insertTask(user.id, { title: "Soon thing", dueDate: today(2) });
    await insertTask(user.id, { title: "Someday thing" });
    await insertTask(user.id, { title: "Finished thing", status: "DONE", dueDate: today(-9) });
    await page.goto("/tasks");

    for (const [heading, title] of [
      ["Overdue", "Late invoice"],
      ["Today", "Today thing"],
      ["Upcoming", "Soon thing"],
      ["No date", "Someday thing"],
    ] as const) {
      const group = page.getByRole("region", { name: new RegExp(`^${heading}`) });
      await expect(group.getByRole("button", { name: title, exact: true })).toBeVisible();
      await expect(group.locator("[data-task-id]")).toHaveCount(1);
    }

    // Overdue is never colour alone: a clock icon, the date, and a word for screen readers.
    const late = taskRow(page, "Late invoice");
    await expect(late).toContainText(chipFor(-3));
    await expect(late.getByText("(overdue)")).toBeAttached();
    await expect(late.locator("svg.lucide-clock")).toBeVisible();

    // Done tasks are not in the open groups.
    await expect(taskRow(page, "Finished thing")).toHaveCount(0);
    await expect(page.getByText("4 open")).toBeVisible();
  });

  test("filters by status and due date, kept in the URL", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Open late", dueDate: today(-1) });
    await insertTask(user.id, { title: "Open today", dueDate: today() });
    await insertTask(user.id, { title: "Waiting one", status: "WAITING" });
    await insertTask(user.id, { title: "Done one", status: "DONE" });
    await insertTask(user.id, { title: "Cancelled one", status: "CANCELLED" });

    await page.goto("/tasks?due=overdue");
    await expect(taskRow(page, "Open late")).toBeVisible();
    await expect(taskRow(page, "Open today")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Due/ })).toContainText("Overdue");

    await page.getByRole("button", { name: /^Due/ }).click();
    await page.getByRole("menuitemradio", { name: "No date" }).click();
    await expect(page).toHaveURL(/due=none/);
    await expect(taskRow(page, "Waiting one")).toBeVisible();

    // No match: an explanation and a way out.
    await page.getByRole("button", { name: /^Due/ }).click();
    await page.getByRole("menuitemradio", { name: "Upcoming" }).click();
    await expect(page.getByText("No tasks match these filters.")).toBeVisible();
    await expect(page.getByText("Nothing is hidden or deleted.")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(taskRow(page, "Open late")).toBeVisible();

    // Statuses: showing Done and Cancelled opens the Completed section.
    await page.goto("/tasks?status=done,cancelled");
    await expect(taskRow(page, "Done one")).toBeVisible();
    // The status badge is part of the row's button name, so a cancelled task is announced as such.
    await expect(page.locator("[data-task-id]").filter({ hasText: "Cancelled one" })).toBeVisible();
    await expect(taskRow(page, "Open late")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Status/ })).toContainText("2 selected");

    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("button", { name: "Clear status filter" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("unknown filter values are ignored rather than breaking the page", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Still here" });
    await page.goto("/tasks?status=bogus&due=never&view=nonsense&task=nope&archived=yes");
    await expect(taskRow(page, "Still here")).toBeVisible();
  });

  test("a new person sees a guiding empty state", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
    await expect(page.getByText("Add one above, or press N.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Inbox" })).toBeVisible();
  });
});

test.describe("emoji", () => {
  test("pick, show on the row, and remove; the picker never contacts a third party", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await page.goto("/tasks");
    await addTask(page, "Emoji task");

    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));

    await openTask(page, "Emoji task");
    const sheet = detailPanel(page);
    await sheet.getByRole("button", { name: "Task emoji" }).click();
    await page
      .getByRole("group", { name: "Quick picks" })
      .getByRole("button", { name: "🎯" })
      .click();

    await expect(taskRow(page, "Emoji task")).toContainText("🎯");
    expect((await taskByTitle(user.id, "Emoji task"))[0]!.emoji).toBe("🎯");
    // The emoji is decoration: hidden from screen readers, the title carries the meaning.
    await expect(
      taskRow(page, "Emoji task").locator("[aria-hidden]", { hasText: "🎯" }),
    ).toBeVisible();

    // The full searchable list loads its data from our own origin.
    await sheet.getByRole("button", { name: "Task emoji" }).click();
    await page.getByLabel("Search emoji").fill("rocket");
    await expect(page.getByRole("gridcell", { name: "Rocket", exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    expect([...hosts].filter((h) => !h.startsWith("localhost"))).toEqual([]);

    await page.getByRole("button", { name: "Remove emoji" }).click();
    await expect(taskRow(page, "Emoji task")).not.toContainText("🎯");
    expect((await taskByTitle(user.id, "Emoji task"))[0]!.emoji).toBeNull();
  });
});

test.describe("keyboard", () => {
  test("N and T start a new task or todo from anywhere, and are ignored while typing", async ({
    page,
  }) => {
    await newUser(page);
    await page.goto("/today");

    await page.keyboard.press("n");
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByLabel("Add task", { exact: true })).toBeFocused();
    await expect(page).not.toHaveURL(/focus=add/);

    // Typing the letter n inside the field types it.
    await page.keyboard.type("an item");
    await expect(page.getByLabel("Add task", { exact: true })).toHaveValue("an item");
    await page.keyboard.press("Escape");

    await page.keyboard.press("t");
    await expect(page).toHaveURL(/view=todos/);
    await expect(page.getByLabel("Add todo", { exact: true })).toBeFocused();
    await page.keyboard.type("note to self");
    await expect(page.getByLabel("Add todo", { exact: true })).toHaveValue("note to self");
  });

  test("Up and Down move between rows, Space toggles, Enter opens, Alt+Up reorders", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Row A", sortOrder: 1000 });
    await insertTask(user.id, { title: "Row B", sortOrder: 2000 });
    await insertTask(user.id, { title: "Row C", sortOrder: 3000 });
    await page.goto("/tasks");

    const titleOf = (t: string) => taskRow(page, t).getByRole("button", { name: t, exact: true });
    await titleOf("Row A").focus();
    await page.keyboard.press("ArrowDown");
    await expect(titleOf("Row B")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(titleOf("Row C")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(titleOf("Row B")).toBeFocused();

    // Alt+Up moves the focused task up one place and keeps focus on it.
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(async () =>
        (await page.locator("[data-task-id] [data-row-focus]").allTextContents()).join(","),
      )
      .toBe("Row B,Row A,Row C");
    await expect(titleOf("Row B")).toBeFocused();

    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () =>
        (await page.locator("[data-task-id] [data-row-focus]").allTextContents()).join(","),
      )
      .toBe("Row A,Row B,Row C");
    await expect(titleOf("Row B")).toBeFocused();

    // Space ticks the box; Enter opens the task.
    await page.keyboard.press("Space");
    await expect(taskRow(page, "Row B").getByRole("checkbox")).toBeChecked();
    await expect(page.getByText("Task completed.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(taskRow(page, "Row B").getByRole("checkbox")).not.toBeChecked();

    await titleOf("Row B").focus();
    await page.keyboard.press("Enter");
    await expect(detailPanel(page)).toBeVisible();
    await expect(detailPanel(page).getByLabel("Task title")).toHaveValue("Row B");
  });

  test("Escape closes the sheet and returns focus to the row; an open menu closes first", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Focus me" });
    await page.goto("/tasks");
    await openTask(page, "Focus me");

    await detailPanel(page)
      .getByRole("button", { name: /^Priority/ })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(detailPanel(page)).toBeVisible(); // only the menu closed

    await detailPanel(page).getByLabel("Task title").focus();
    await page.keyboard.press("Escape"); // reverts the title edit and blurs it
    await page.keyboard.press("Escape");
    await expect(detailPanel(page)).toHaveCount(0);
    await expect(
      taskRow(page, "Focus me").getByRole("button", { name: "Focus me", exact: true }),
    ).toBeFocused();
  });

  test("the close button also closes the sheet", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Closable" });
    await page.goto("/tasks");
    await openTask(page, "Closable");
    await detailPanel(page).getByRole("button", { name: "Close task" }).click();
    await expect(detailPanel(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);
  });
});

test.describe("accessibility", () => {
  test("checkboxes, groups and the detail panel are named for assistive technology", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Named task", dueDate: today(), priority: "MEDIUM" });
    await page.goto("/tasks");

    await expect(page.getByRole("checkbox", { name: "Complete Named task" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("region", { name: /^Today/ })).toBeVisible();
    await expect(
      taskRow(page, "Named task").getByRole("img", { name: "Priority: Medium" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Tasks or todos" })).toBeVisible();

    await openTask(page, "Named task");
    await expect(detailPanel(page).getByRole("toolbar", { name: "Formatting" })).toBeVisible();
    await expect(
      detailPanel(page).getByRole("textbox", { name: "Task description" }),
    ).toBeVisible();
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Bulleted list",
      "Numbered list",
      "Checklist",
      "Link",
      "Inline code",
    ]) {
      await expect(detailPanel(page).getByRole("button", { name, exact: true })).toBeVisible();
    }
  });
});
