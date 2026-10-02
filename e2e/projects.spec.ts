import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertNote,
  insertProject,
  insertTag,
  insertTask,
  insertTodo,
  noteByTitle,
  projectByName,
  tagByName,
  tagCount,
  tagNote,
  tagTask,
  tagsOfTask,
  taskByTitle,
  taskProject,
  todoByTitle,
  todoProject,
} from "./db";
import { newDevice, signUp, taskRow, todoRow } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  const user = (await findUser(account.email))!;
  return { account, user };
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Task detail" });
const progress = (page: Page) => page.getByRole("progressbar", { name: "Progress" });

test.describe("creating and managing projects", () => {
  test("create a project, add a task, a todo and a note from it, and watch progress move", async ({
    page,
  }) => {
    test.slow(); // a long journey: each Undo toast alone takes five seconds to close
    const { user } = await newUser(page);
    await page.goto("/projects");
    await expect(page.getByText("No projects yet.")).toBeVisible();

    await page.getByRole("button", { name: "New project" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Acme rebrand");
    await dialog.getByLabel("Description").fill("Brand refresh for Acme");
    await dialog.getByRole("radio", { name: "Blue" }).click();
    await dialog.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Project name")).toHaveValue("Acme rebrand");
    await expect(page.getByText("No items yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Nothing here yet.")).toBeVisible();
    const project = (await projectByName(user.id, "Acme rebrand"))!;
    expect(project).toMatchObject({
      color: "blue",
      description: "Brand refresh for Acme",
      status: "ACTIVE",
    });

    // Quick add: a task, a todo and a note, all inside the project.
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByLabel("New task in this project").fill("Send invoice");
    await page.keyboard.press("Enter");
    await expect(taskRow(page, "Send invoice")).toBeVisible();

    await page.getByRole("button", { name: "Add todo" }).click();
    await page.getByLabel("New todo in this project").fill("Order cards");
    await page.keyboard.press("Enter");
    await expect(todoRow(page, "Order cards")).toBeVisible();

    const [task] = await taskByTitle(user.id, "Send invoice");
    const [todo] = await todoByTitle(user.id, "Order cards");
    expect(await taskProject(task!.id)).toBe(project.id);
    expect(await todoProject(todo!.id)).toBe(project.id);
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByText("0 of 2 items done")).toBeVisible();

    await page.getByRole("link", { name: "Add note" }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/new\\?project=${project.id}`));
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
      "Acme rebrand",
    );
    await page.getByLabel("Note title").fill("Kickoff");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Kickoff"))?.project_id)
      .toBe(project.id);

    // Back on the project: the note is listed, and completing the task moves progress to 50%.
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("link", { name: /Kickoff/ })).toBeVisible();
    await taskRow(page, "Send invoice").getByRole("checkbox").click();
    await expect(page.getByText("Task completed.")).toHaveCount(0, { timeout: 12_000 });
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "50");
    await expect(page.getByText("1 of 2 items done")).toBeVisible();

    // The list shows it too.
    await page.goto("/projects");
    const card = page.getByRole("link", { name: /Acme rebrand/ });
    await expect(card).toContainText("1 open");
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  test("edit the name, description and status in place; completed projects move down the list", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertProject(user.id, { name: "Draft name" });
    await insertProject(user.id, { name: "Other", status: "ON_HOLD" });
    await page.goto(`/projects/${id}`);

    await page.getByLabel("Project name").fill("Final name");
    await page.getByLabel("Project name").blur();
    await expect.poll(async () => (await projectByName(user.id, "Final name"))?.id).toBe(id);

    await page.getByLabel("Project description").fill("What it is for");
    await page.getByLabel("Project description").blur();
    await expect
      .poll(async () => (await projectByName(user.id, "Final name"))?.description)
      .toBe("What it is for");

    // An empty name is refused and the old one comes back.
    await page.getByLabel("Project name").fill("   ");
    await page.getByLabel("Project name").blur();
    await expect(page.getByText("Enter a project name.")).toBeVisible();
    await expect(page.getByLabel("Project name")).toHaveValue("Final name");

    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Completed" }).click();
    await expect
      .poll(async () => (await projectByName(user.id, "Final name"))?.status)
      .toBe("COMPLETED");

    await page.goto("/projects");
    await expect(
      page.getByRole("region", { name: "Completed" }).getByRole("link", { name: /Final name/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "On hold" }).getByRole("link", { name: /Other/ }),
    ).toBeVisible();
  });

  test("Edit details changes the colour; archived projects sit in a collapsed section", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertProject(user.id, { name: "Paint me", color: "slate" });
    await insertProject(user.id, { name: "Shelved", status: "ARCHIVED" });
    await page.goto(`/projects/${id}`);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Pink" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await projectByName(user.id, "Paint me"))?.color).toBe("pink");

    await page.goto("/projects");
    await expect(page.getByRole("link", { name: /Shelved/ })).toBeHidden();
    await page.locator("summary", { hasText: "Archived" }).click();
    await expect(page.getByRole("link", { name: /Shelved/ })).toBeVisible();
  });

  test("deleting a project keeps its items, shown as No project, and restoring brings the grouping back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertProject(user.id, { name: "Doomed project", color: "green" });
    const taskId = await insertTask(user.id, { title: "Stays put" });
    const { setTaskProject } = await import("./db");
    await setTaskProject(taskId, id);
    const noteId = await insertNote(user.id, { title: "Stays too", projectId: id });
    await page.goto(`/tasks`);
    await expect(taskRow(page, "Stays put")).toContainText("Doomed project");

    await page.goto(`/projects/${id}`);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("The tasks and notes in it are kept.")).toBeVisible();
    await dialog.getByRole("button", { name: "Move to Trash" }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText("Project moved to Trash.")).toBeVisible();
    await expect(page.getByText("No projects yet.")).toBeVisible();

    // Items are still there, with no project.
    await page.goto("/tasks");
    await expect(taskRow(page, "Stays put")).toBeVisible();
    await expect(taskRow(page, "Stays put")).not.toContainText("Doomed project");
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Stays too/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Stays too/ })).not.toContainText("Doomed project");
    // Nothing was lost in the database: the link is kept so a restore can bring it back.
    expect(await taskProject(taskId)).toBe(id);
    expect((await noteByTitle(user.id, "Stays too"))?.project_id).toBe(id);
    // The deleted project's own page is gone.
    await page.goto(`/projects/${id}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();

    // Undo from the toast brings it back (undo within five seconds of deleting).
    await page.goto(`/projects`);
    expect(noteId).toBeTruthy();
  });

  test("Undo on the delete toast restores the project and its grouping", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertProject(user.id, { name: "Undo me", color: "teal" });
    const taskId = await insertTask(user.id, { title: "Grouped task" });
    const { setTaskProject } = await import("./db");
    await setTaskProject(taskId, id);
    await page.goto(`/projects/${id}`);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("link", { name: /Undo me/ })).toBeVisible();
    await expect
      .poll(async () => (await projectByName(user.id, "Undo me"))?.deleted_at ?? null)
      .toBeNull();
    await page.goto("/tasks");
    await expect(taskRow(page, "Grouped task")).toContainText("Undo me");
  });
});

test.describe("choosing a project for tasks, todos and notes", () => {
  test("the task detail picker lists active projects first, offers No project, and can create one", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme", color: "blue" });
    await insertProject(user.id, { name: "Zeta hold", status: "ON_HOLD" });
    await insertProject(user.id, { name: "Beta", status: "ACTIVE" });
    const taskId = await insertTask(user.id, { title: "Pick a project" });
    await page.goto(`/tasks?task=${taskId}`);

    await panel(page)
      .getByRole("button", { name: /^Project/ })
      .click();
    const names = await page.getByRole("button", { name: /Acme|Beta|Zeta hold/ }).allTextContents();
    expect(names.map((n) => n.replace("(current)", "").trim())).toEqual([
      "Acme",
      "Beta",
      "Zeta hold",
    ]);
    await page.getByRole("button", { name: "Acme" }).click();
    await expect(panel(page).getByRole("button", { name: /^Project/ })).toContainText("Acme");
    await expect.poll(async () => taskProject(taskId)).toBe(acme);
    await expect(taskRow(page, "Pick a project")).toContainText("Acme");

    // Search narrows the list.
    await panel(page)
      .getByRole("button", { name: /^Project/ })
      .click();
    await page.getByLabel("Search projects").fill("zet");
    await expect(page.getByRole("button", { name: "Zeta hold" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Beta" })).toHaveCount(0);

    // No project is always one click away.
    await page.getByRole("button", { name: "No project" }).click();
    await expect(panel(page).getByRole("button", { name: /^Project/ })).toContainText("None");
    await expect.poll(async () => taskProject(taskId)).toBeNull();

    // And a new project can be made from the picker.
    await panel(page)
      .getByRole("button", { name: /^Project/ })
      .click();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Made in picker");
    await page.getByRole("dialog").getByRole("button", { name: "Create project" }).click();
    await expect(panel(page).getByRole("button", { name: /^Project/ })).toContainText(
      "Made in picker",
    );
    const made = (await projectByName(user.id, "Made in picker"))!;
    await expect.poll(async () => taskProject(taskId)).toBe(made.id);
  });

  test("a subtask follows its task's project", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    const parent = await insertTask(user.id, { title: "Parent" });
    const sub = await insertTask(user.id, { title: "Child", parentTaskId: parent });
    await page.goto(`/tasks?task=${parent}`);
    await panel(page)
      .getByRole("button", { name: /^Project/ })
      .click();
    await page.getByRole("button", { name: "Acme" }).click();
    await expect.poll(async () => taskProject(sub)).toBe(acme);

    // The subtask's own page shows the project but won't let it be changed.
    await page.goto(`/tasks/${sub}`);
    const picker = page.getByRole("button", { name: /^Project/ });
    await expect(picker).toContainText("Acme");
    await expect(picker).toBeDisabled();
  });

  test("a todo can be put in a project from its edit dialog", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    const todoId = await insertTodo(user.id, { title: "Loose todo" });
    await page.goto("/tasks?view=todos");
    await todoRow(page, "Loose todo")
      .getByRole("button", { name: "Loose todo", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("button", { name: "Acme" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => todoProject(todoId)).toBe(acme);
  });

  test("a note can be moved between projects from its menu", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    const noteId = await insertNote(user.id, { title: "Movable", text: "x" });
    await page.goto(`/notes/${noteId}`);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Project/ }).click();
    await page.getByRole("button", { name: "Acme" }).click();
    await expect.poll(async () => (await noteByTitle(user.id, "Movable"))?.project_id).toBe(acme);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Acme");
    // Moving a note doesn't count as editing it.
    expect((await noteByTitle(user.id, "Movable"))?.version).toBe(1);
  });

  test("tasks can be filtered by project", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    const inAcme = await insertTask(user.id, { title: "In Acme" });
    await insertTask(user.id, { title: "No project here" });
    const { setTaskProject } = await import("./db");
    await setTaskProject(inAcme, acme);
    await page.goto("/tasks");
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "Acme" }).click();
    await expect(page).toHaveURL(/project=/);
    await expect(taskRow(page, "In Acme")).toBeVisible();
    await expect(taskRow(page, "No project here")).toHaveCount(0);

    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(taskRow(page, "No project here")).toBeVisible();
    await expect(taskRow(page, "In Acme")).toHaveCount(0);
  });
});

test.describe("tags", () => {
  test("create inline on a task, filter by it, rename, and delete", async ({ page }) => {
    const { user } = await newUser(page);
    const tagged = await insertTask(user.id, { title: "Tag me" });
    await insertTask(user.id, { title: "Leave me" });
    await page.goto(`/tasks?task=${tagged}`);

    // Create inline: type, Enter.
    await panel(page).getByRole("button", { name: "Add tag" }).click();
    await page.getByLabel("Find or create a tag").fill("Client");
    await expect(page.getByRole("button", { name: /Create “Client”/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemcheckbox", { name: "Client" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(panel(page).getByText("Client")).toBeVisible();
    await expect
      .poll(async () => (await tagsOfTask(tagged)).map((t) => t.name))
      .toEqual(["Client"]);
    await expect(taskRow(page, "Tag me")).toContainText("Client");

    // Typing the same name in other letters finds the same tag instead of making a second.
    await panel(page).getByRole("button", { name: "Edit tags" }).click();
    await page.getByLabel("Find or create a tag").fill("client");
    await expect(page.getByRole("button", { name: /Create “/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(await tagCount(user.id)).toBe(1);

    // Filter by tag.
    await page.goto("/tasks");
    await page.getByRole("button", { name: /^Tag Any$/ }).click();
    await page.getByRole("menuitemradio", { name: "Client" }).click();
    await expect(page).toHaveURL(/tag=/);
    await expect(taskRow(page, "Tag me")).toBeVisible();
    await expect(taskRow(page, "Leave me")).toHaveCount(0);

    // Rename in Settings → Tags; the clash is refused with a message.
    await insertTag(user.id, "Waiting");
    await page.goto("/settings/tags");
    await expect(page.getByText("1 task")).toBeVisible();
    await page.getByRole("button", { name: "Rename Client" }).click();
    await page.getByLabel("Rename Client").fill("waiting");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("A tag with that name already exists.")).toBeVisible();
    await page.getByLabel("Rename Client").fill("Customer");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Customer")).toBeVisible();
    expect(await tagByName(user.id, "Customer")).not.toBeNull();
    expect(await tagByName(user.id, "Client")).toBeNull();

    // Colour.
    await page.getByRole("button", { name: "Colour for Customer" }).click();
    await page.getByRole("radio", { name: "Violet" }).click();
    await expect.poll(async () => (await tagByName(user.id, "Customer"))?.color).toBe("violet");
    await page.keyboard.press("Escape");

    // Delete: asks first, says how many, keeps the task.
    await page.getByRole("button", { name: "Delete Customer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("It will be removed from 1 task and 0 notes.")).toBeVisible();
    await dialog.getByRole("button", { name: "Delete tag" }).click();
    await expect.poll(async () => tagByName(user.id, "Customer")).toBeNull();
    expect((await taskByTitle(user.id, "Tag me"))[0]).toBeTruthy();
    expect(await tagsOfTask(tagged)).toEqual([]);
  });

  test("Settings → Tags shows usage and an empty state", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/settings/tags");
    await expect(page.getByText("No tags yet.")).toBeVisible();

    const t = await insertTask(user.id, { title: "T" });
    const n = await insertNote(user.id, { title: "N" });
    const tag = await insertTag(user.id, "Both", "amber");
    await tagTask(t, tag, user.id);
    await tagNote(n, tag, user.id);
    await page.goto("/settings/tags");
    await expect(page.getByText("1 task, 1 note")).toBeVisible();
    await expect(page.getByRole("link", { name: "Tags" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("one person can't reach another's projects", () => {
  test("someone else's project is not found and isn't listed", async ({ browser, page }) => {
    const { user: alice } = await newUser(page);
    const projectId = await insertProject(alice.id, { name: "Alice project" });
    const taskId = await insertTask(alice.id, { title: "Alice task" });

    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    const bob = await signUp(bobPage);
    const bobUser = (await findUser(bob.email))!;

    await bobPage.goto(`/projects/${projectId}`);
    await expect(bobPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await bobPage.goto("/projects/not-an-id");
    await expect(bobPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await bobPage.goto("/projects");
    await expect(bobPage.getByText("Alice project")).toHaveCount(0);
    await expect(bobPage.getByText("No projects yet.")).toBeVisible();

    // Bob can't tag, assign or filter with Alice's ids through the address bar.
    await bobPage.goto(`/tasks?project=${projectId}`);
    await expect(bobPage.getByText("Alice task")).toHaveCount(0);
    await bobPage.goto(`/tasks?task=${taskId}`);
    await expect(bobPage.getByRole("complementary", { name: "Task detail" })).toHaveCount(0);
    expect(await projectByName(bobUser.id, "Alice project")).toBeNull();
    expect((await projectByName(alice.id, "Alice project"))?.id).toBe(projectId);
    await context.close();
  });
});
