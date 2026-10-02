import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertNote,
  insertProject,
  insertTag,
  insertTask,
  insertTodo,
  setTaskDescription,
  tagNote,
  tagTask,
} from "./db";
import { newDevice, signUp, today } from "./helpers";

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const menu = (page: Page) => page.getByRole("dialog");

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("command menu search", () => {
  test("finds a task by its description, a note by its body and a project by name; keyboard opens the result", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const task = await insertTask(user.id, { title: "Quarterly planning" });
    await setTaskDescription(task, "needs the zebra budget numbers");
    await insertNote(user.id, {
      title: "Meeting",
      text: "we should discuss the zebra crossing plan",
    });
    await insertProject(user.id, { name: "Zebra rollout" });
    await page.goto("/today");

    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("zebra");
    await expect(menu(page).getByRole("option", { name: /Quarterly planning/ })).toBeVisible();
    await expect(menu(page).getByRole("option", { name: /Meeting/ })).toBeVisible();
    await expect(menu(page).getByRole("option", { name: /Zebra rollout/ })).toBeVisible();
    // Grouped by type.
    for (const group of ["Tasks", "Notes", "Projects"])
      await expect(menu(page).getByText(group, { exact: true })).toBeVisible();

    // The first row is always "Capture … to Inbox"; arrow down to the first result and open it.
    await expect(menu(page).getByRole("option").first()).toContainText("Capture “zebra” to Inbox");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${task}`));
    await expect(menu(page)).toHaveCount(0);
  });

  test("with nothing typed it shows quick actions, recent searches and recent items", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Latest note", text: "x" });
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(menu(page).getByText("Quick actions")).toBeVisible();
    for (const label of ["New task", "New todo", "New note", "New project"]) {
      await expect(menu(page).getByRole("option", { name: label })).toBeVisible();
    }
    await expect(menu(page).getByRole("option", { name: /Latest note/ })).toBeVisible();

    // A search that was opened is remembered for next time (this browser only).
    await page.keyboard.type("latest");
    await expect(
      menu(page)
        .getByRole("option", { name: /Latest note/ })
        .last(),
    ).toBeVisible();
    await expect(menu(page).getByText("Notes", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\//);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(menu(page).getByText("Recent searches", { exact: true })).toBeVisible();
    await expect(menu(page).getByRole("option", { name: "latest", exact: true })).toBeVisible();
  });

  test("shows a no-results message but still offers to capture; Esc closes", async ({ page }) => {
    const { user } = await newUser(page);
    const before = await (await import("./db")).inboxItemsOf(user.id);
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("zebra crossing");
    await expect(menu(page).getByText("Nothing matches “zebra crossing”.")).toBeVisible();
    await expect(
      menu(page).getByRole("option", { name: /Capture “zebra crossing” to Inbox/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    expect(before).toHaveLength(0);
  });

  test("Create mode, Tab to switch, and the quick actions go where they say", async ({ page }) => {
    await newUser(page);
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    // Tab cycles Search -> Ask -> Create (Ask is there because AI is on).
    await page.keyboard.press("Tab");
    await expect(menu(page).getByRole("tab", { name: "ask", selected: true })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu(page).getByRole("tab", { name: "create", selected: true })).toBeVisible();
    await menu(page).getByRole("option", { name: "New note" }).click();
    await expect(page).toHaveURL(/\/notes\/new/);

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await menu(page).getByRole("option", { name: "New project" }).click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole("dialog").getByLabel("Name")).toBeVisible();
  });

  test("the top bar search opens it, and Cmd/Ctrl+K toggles it", async ({ page }) => {
    await newUser(page);
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Search, ask or create/ }).click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(menu(page)).toHaveCount(0);
  });

  test("special characters are searched literally", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Save 50% today" });
    await insertTask(user.id, { title: "Save 500 today" });
    await page.goto("/search?q=50%25");
    await expect(page.getByRole("link", { name: /Save 50% today/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Save 500 today/ })).toHaveCount(0);
  });
});

test.describe("search page", () => {
  test("searches everything, labels archived items, highlights the match as text, and filters", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const project = await insertProject(user.id, { name: "Acme", color: "blue" });
    const a = await insertTask(user.id, {
      title: "Send invoice to studio",
      dueDate: today(-2),
    });
    await insertTask(user.id, { title: "Follow up with accounts" });
    await setTaskDescription(
      (await import("./db").then((m) => m.taskByTitle(user.id, "Follow up with accounts")))[0]!.id,
      "waiting for the invoice number first",
    );
    await insertNote(user.id, {
      title: "Client call",
      text: "send the invoice once the brand review is signed off",
    });
    await insertNote(user.id, { title: "Old invoice archive", text: "x", archived: true });
    await insertProject(user.id, { name: "Invoice tracker" });
    const tag = await insertTag(user.id, "invoice-tag", "teal");
    await tagTask(a, tag, user.id);
    await insertTodo(user.id, { title: "Pay the invoice" });
    expect(project).toBeTruthy();

    await page.goto("/search?q=invoice");
    await expect(page.getByRole("status")).toContainText(/\d+ results/);
    const results = page.getByRole("list", { name: "Search results" });
    await expect(results.getByRole("link", { name: /Send invoice to studio/ })).toContainText(
      "Overdue",
    );
    await expect(results.getByRole("link", { name: /Follow up with accounts/ })).toContainText(
      "waiting for the invoice number first",
    );
    await expect(results.getByRole("link", { name: /Client call/ })).toContainText("brand review");
    await expect(results.getByRole("link", { name: /Old invoice archive/ })).toContainText(
      "Archived",
    );
    await expect(results.getByRole("link", { name: /Invoice tracker/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Pay the invoice/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /invoice-tag/ })).toContainText(
      "Tag, 1 task and 0 notes",
    );
    // The match is wrapped in <mark>, from plain text.
    await expect(results.locator("mark").first()).toBeVisible();
    expect(await results.locator("mark").first().textContent()).toMatch(/invoice/i);

    // Type tabs.
    await page
      .getByRole("navigation", { name: "Result type" })
      .getByRole("link", { name: "Notes", exact: true })
      .click();
    await expect(page).toHaveURL(/type=note/);
    await expect(results.getByRole("link", { name: /Client call/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Send invoice to studio/ })).toHaveCount(0);

    // Status narrows to tasks.
    await page.goto("/search?q=invoice");
    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("menuitemradio", { name: "Planned" }).click();
    await expect(page).toHaveURL(/status=planned/);
    await expect(results.getByRole("link", { name: /Send invoice to studio/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Client call/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(results.getByRole("link", { name: /Client call/ })).toBeVisible();

    // Tag, and date range (due / updated).
    await page.getByRole("button", { name: /^Tag/ }).click();
    await page.getByRole("menuitemradio", { name: "invoice-tag" }).click();
    await expect(results.getByRole("link", { name: /Send invoice to studio/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Pay the invoice/ })).toHaveCount(0);

    await page.goto(`/search?q=invoice&from=${today(-5)}&to=${today(-1)}`);
    await expect(results.getByRole("link", { name: /Send invoice to studio/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Pay the invoice/ })).toHaveCount(0);
  });

  test("tab, project and 'No project' filters", async ({ page }) => {
    const { user } = await newUser(page);
    const acme = await insertProject(user.id, { name: "Acme" });
    await insertNote(user.id, { title: "plum in acme", text: "x", projectId: acme });
    await insertNote(user.id, { title: "plum loose", text: "x" });
    await page.goto("/search?q=plum");
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "Acme" }).click();
    await expect(page.getByRole("link", { name: /plum in acme/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /plum loose/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.getByRole("menuitemradio", { name: "No project" }).click();
    await expect(page.getByRole("link", { name: /plum loose/ })).toBeVisible();
  });

  test("results open the item, and empty or too-short searches explain themselves", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Findable note", text: "x" });
    await page.goto("/search");
    await expect(page.getByText("Find anything.")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search" }).fill("a");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Keep typing to search.")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search" }).fill("findable");
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: /Findable note/ }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}`));

    await page.goto("/search?q=zzzzqq");
    await expect(page.getByText("Nothing matches “zzzzqq”.")).toBeVisible();
    await page.goto("/search?q=zzzzqq&status=done");
    await expect(page.getByText("Try fewer words, or clear the filters.")).toBeVisible();
  });
});

test.describe("search never leaks across people", () => {
  test("another person's matching items never appear, in the menu or on the page", async ({
    browser,
    page,
  }) => {
    const { user: alice } = await newUser(page);
    await insertNote(alice.id, { title: "gooseberry plan", text: "gooseberry body" });
    await insertProject(alice.id, { name: "gooseberry project" });
    await insertTask(alice.id, { title: "gooseberry task" });
    const tag = await insertTag(alice.id, "gooseberry");
    const noteId = await insertNote(alice.id, { title: "tagged goose", text: "x" });
    await tagNote(noteId, tag, alice.id);

    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    await signUp(bobPage);
    await bobPage.goto("/search?q=gooseberry");
    await expect(bobPage.getByText("Nothing matches “gooseberry”.")).toBeVisible();
    await bobPage.goto("/today");
    await bobPage.keyboard.press("ControlOrMeta+k");
    await bobPage.keyboard.type("gooseberry");
    await expect(
      bobPage.getByRole("dialog").getByText("Nothing matches “gooseberry”."),
    ).toBeVisible();
    await expect(
      bobPage.getByRole("dialog").getByRole("option", { name: /gooseberry (plan|project|task)/ }),
    ).toHaveCount(0);

    // And for Alice they are all there.
    await page.goto("/search?q=gooseberry");
    await expect(page.getByRole("link", { name: /gooseberry plan/ })).toBeVisible();
    await context.close();
  });

  test("the search endpoint needs a signed-in person", async ({ request }) => {
    const response = await request.get("/api/search?q=anything");
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });
});
