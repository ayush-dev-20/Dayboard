import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  aiUsageOf,
  fillAiMinute,
  focusTaskOf,
  findUser,
  insertNote,
  insertNoteDoc,
  insertTask,
  noteByTitle,
  setAiEnabled,
  taskByTitle,
  notesOf,
  taskDescriptionText,
} from "./db";
import { detailPanel, newDevice, openTask, signUp, today } from "./helpers";

// Feature 08: Generate with AI, Plan my day and Writing help. Mock provider only: no network, no
// key, no cost.

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

test.use({ viewport: { width: 1280, height: 800 } });

const draft = (page: Page) => page.getByRole("document", { name: "Draft" });
const prompt = (page: Page) => page.getByRole("textbox", { name: "What should it write?" });
const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });

async function generate(page: Page, text: string) {
  await prompt(page).fill(text);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft ready" })).toBeAttached({
    timeout: 20_000,
  });
}

test.describe("Generate with AI", () => {
  test("Notes page → Write with AI → streamed, formatted draft → Create note", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    await page.goto("/notes");
    await page.getByRole("link", { name: "Write with AI" }).click();
    await expect(page).toHaveURL(/\/notes\/new\?ai=1$/);
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole("checkbox", { name: "Write the title too" })).toBeChecked();

    await generate(page, "Acme rebrand brief");

    // Formatted like the editor: heading, lists, checklist, quote, code, divider. A table is
    // converted, never shown.
    const preview = draft(page);
    await expect(
      preview.getByRole("heading", { name: "Acme rebrand brief", level: 1 }),
    ).toBeVisible();
    await expect(preview.locator("ul:not([data-type=taskList]) li").first()).toBeVisible();
    await expect(preview.locator("ol li").first()).toBeVisible();
    await expect(preview.locator("ul[data-type=taskList] li")).toHaveCount(2);
    await expect(preview.locator("blockquote")).toBeVisible();
    await expect(preview.locator("pre code")).toContainText("const ready = true;");
    await expect(preview.locator("hr")).toBeVisible();
    await expect(preview.locator("table")).toHaveCount(0);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Acme rebrand brief");
    await expect(page.getByText("TITLE:")).toHaveCount(0);

    // Nothing exists until the click.
    expect(await notesOf(user.id)).toHaveLength(0);

    await page.getByRole("button", { name: "Create note" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);

    const note = (await noteByTitle(user.id, "Acme rebrand brief"))!;
    expect(note).toBeTruthy();
    const types = (note.content_json.content ?? []).map((n) => n.type);
    for (const type of [
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
    ]) {
      expect(types, type).toContain(type);
    }
    await expect(editor(page).getByRole("heading", { name: "Acme rebrand brief" })).toBeVisible();
    const usage = await aiUsageOf(user.id);
    expect(usage.filter((u) => u.feature === "GENERATE_CONTENT")).toEqual([
      expect.objectContaining({ status: "SUCCESS" }),
    ]);
  });

  test("an open note: insert at the end, saved, and one undo removes it", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Launch plan", text: "Existing words." });
    await page.goto(`/notes/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Generate with AI" }).click();
    // The note has a title, so the title option is off and context is on.
    await expect(page.getByRole("checkbox", { name: "Write the title too" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Use this note as context" })).toBeChecked();

    await generate(page, "Risks for the launch");
    await page.getByRole("button", { name: "Insert at end" }).click();

    await expect(editor(page)).toContainText("Existing words.");
    await expect(editor(page)).toContainText("Paragraph 3 of the draft");
    await expect
      .poll(async () => (await noteByTitle(user.id, "Launch plan"))!.content_text)
      .toContain("Paragraph 3 of the draft");

    // One undo removes the whole insertion, and that is saved too.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor(page)).not.toContainText("Paragraph 3 of the draft");
    await expect(editor(page)).toContainText("Existing words.");
    await expect
      .poll(async () => (await noteByTitle(user.id, "Launch plan"))!.content_text)
      .not.toContain("Paragraph 3 of the draft");
    await page.reload();
    await expect(editor(page)).toContainText("Existing words.");
    await expect(editor(page)).not.toContainText("Paragraph 3 of the draft");
  });

  test("Replace everything is a separate step, and Undo in the toast restores the note", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Old note", text: "Keep me safe." });
    await page.goto(`/notes/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Generate with AI" }).click();
    await generate(page, "A fresh start");

    await page.getByRole("button", { name: "Where to put it" }).click();
    await page.getByRole("menuitemradio", { name: "Replace everything" }).click();
    await expect(
      page.getByText("This replaces the whole note. You can undo with ⌘Z."),
    ).toBeVisible();
    // Nothing changed yet.
    await expect(editor(page)).toContainText("Keep me safe.");

    await page.getByRole("button", { name: "Replace note" }).click();
    await expect(editor(page)).not.toContainText("Keep me safe.");
    await expect(editor(page)).toContainText("Paragraph 1 of the draft");
    await expect(page.getByText("Note replaced.")).toBeVisible();

    await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
    await expect(editor(page)).toContainText("Keep me safe.");
    await expect
      .poll(async () => (await noteByTitle(user.id, "Old note"))!.content_text)
      .toContain("Keep me safe.");
  });

  test("⌘K → Write a note with AI opens the panel; leaving creates nothing", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Create" }).click();
    await page.getByRole("option", { name: "Write a note with AI" }).click();
    await expect(page).toHaveURL(/\/notes\/new\?ai=1$/);
    await expect(prompt(page)).toBeVisible();
    await page.goto("/notes");
    expect(await notesOf(user.id)).toHaveLength(0);
  });

  test("a task description: Generate with AI → Add to end, saved", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the report" });
    await page.goto("/tasks");
    await openTask(page, "Write the report");
    const panel = detailPanel(page);
    await panel.getByRole("button", { name: "Generate with AI" }).click();
    await expect(panel.getByRole("checkbox", { name: "Write the title too" })).toHaveCount(0);

    await panel
      .getByRole("textbox", { name: "What should it write?" })
      .fill("Outline of the report");
    await panel.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Add to end" })).toBeEnabled({
      timeout: 20_000,
    });
    await panel.getByRole("button", { name: "Add to end" }).click();

    await expect(
      panel.getByRole("textbox", { name: "Task description" }).getByRole("heading", {
        name: "Outline of the report",
      }),
    ).toBeVisible();
    await expect.poll(async () => taskDescriptionText(taskId)).toContain("Outline of the report");
    // The title was never touched.
    await expect(panel.getByLabel("Task title")).toHaveValue("Write the report");
  });

  test("Short, Standard and Detailed produce more and more content", async ({ page }) => {
    test.slow();
    await newUser(page);
    await page.goto("/notes/new?ai=1");
    const counts: number[] = [];
    for (const length of ["Short", "Standard", "Detailed"]) {
      await page.getByRole("radio", { name: length }).click();
      await generate(page, "Quarterly goals");
      counts.push(
        await draft(page)
          .getByText(/^Paragraph \d+ of the draft/)
          .count(),
      );
      await page.getByRole("button", { name: "Edit prompt" }).click();
    }
    expect(counts).toEqual([1, 3, 6]);
  });
});

const boldItemDoc = (text: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Intro line." }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] },
          ],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Second item." }] }],
        },
      ],
    },
  ],
});

const helpPanel = (page: Page) => page.getByRole("dialog", { name: "Writing help" });

/** Selects one line of text by keyboard (repeated triple clicks are unreliable in the browser). */
async function selectLine(page: Page, text: Locator) {
  await text.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
}

async function chooseHelp(page: Page, mode: string) {
  await page.getByRole("button", { name: "Improve writing" }).click();
  await page.getByRole("menuitem", { name: mode }).click();
}

test.describe("Writing help", () => {
  test("the dropdown opens under the floating button, and the floating menu stays", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const original = "a line to select for the menu.";
    const id = await insertNoteDoc(user.id, "Menu place", boldItemDoc(original), original);
    await page.goto(`/notes/${id}`);

    await selectLine(page, editor(page).locator("li").first().getByText(original));
    const trigger = page.getByRole("button", { name: "Improve writing" });
    await trigger.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    // Tiptap removes its floating menu when the editor loses focus. The dropdown lives inside it,
    // so it stays; otherwise the dropdown lost its anchor and opened at the window's top-left.
    await expect(trigger).toBeVisible();

    const button = (await trigger.boundingBox())!;
    const list = (await menu.boundingBox())!;
    expect(Math.abs(list.x - button.x)).toBeLessThan(24);
    const gap = list.y - (button.y + button.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(40);
  });

  test("Improve replaces a bold list item in place; undo restores it; Discard changes nothing", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const original = "teh bold item to improve.";
    const id = await insertNoteDoc(
      user.id,
      "Help me",
      boldItemDoc(original),
      `Intro line.\n${original}\nSecond item.`,
    );
    await page.goto(`/notes/${id}`);

    const item = editor(page).locator("li").first();
    await selectLine(page, item.getByText(original));
    await chooseHelp(page, "Improve");

    const panel = helpPanel(page);
    await expect(panel.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Replace" })).toBeEnabled({ timeout: 20_000 });
    await expect(panel.getByRole("region", { name: "Before" })).toContainText(original);
    await expect(panel.getByRole("region", { name: "After" })).toContainText(
      `${original} (improved)`,
    );

    // Discard changes nothing.
    await panel.getByRole("button", { name: "Discard" }).click();
    await expect(panel).toHaveCount(0);
    await expect(item).toHaveText(original);

    await selectLine(page, item.getByText(original));
    await chooseHelp(page, "Improve");
    await expect(helpPanel(page).getByRole("button", { name: "Replace" })).toBeEnabled({
      timeout: 20_000,
    });
    await helpPanel(page).getByRole("button", { name: "Replace" }).click();

    // Still a list item, still bold.
    await expect(editor(page).locator("li").first()).toHaveText(`${original} (improved)`);
    await expect(editor(page).locator("li").first().locator("strong")).toHaveText(
      `${original} (improved)`,
    );
    await expect(editor(page).locator("li")).toHaveCount(2);

    // One undo restores the original and its formatting.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor(page).locator("li").first()).toHaveText(original);
    await expect(editor(page).locator("li").first().locator("strong")).toHaveText(original);
  });

  test("Fix grammar and Shorten", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Typos",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "I recieve teh mail. It is definately here." }],
          },
        ],
      },
      "I recieve teh mail. It is definately here.",
    );
    await page.goto(`/notes/${id}`);
    const paragraph = editor(page).getByText("I recieve teh mail.");
    await selectLine(page, paragraph);
    await chooseHelp(page, "Fix grammar");
    await helpPanel(page).getByRole("button", { name: "Replace" }).click({ timeout: 20_000 });
    await expect(editor(page)).toContainText("I receive the mail. It is definitely here.");

    await selectLine(page, editor(page).getByText("I receive the mail."));
    await chooseHelp(page, "Shorten");
    await helpPanel(page).getByRole("button", { name: "Replace" }).click({ timeout: 20_000 });
    await expect(editor(page)).toHaveText("I receive the mail.");
  });

  test("Continue inserts new paragraphs below", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Story", text: "Once upon a time." });
    await page.goto(`/notes/${id}`);
    await editor(page).getByText("Once upon a time.").click();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Writing help" }).click();
    await page.getByRole("menuitem", { name: /^Continue/ }).click();
    await helpPanel(page).getByRole("button", { name: "Insert below" }).click({ timeout: 20_000 });
    await expect(editor(page).locator("p")).toHaveCount(3);
    await expect(editor(page).locator("p").first()).toHaveText("Once upon a time.");
    await expect(editor(page)).toContainText("And so the next part follows");
  });

  test("a failure shows Retry and leaves the note untouched", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Broken", text: "Please [mock:error] help." });
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("Please [mock:error] help."));
    await chooseHelp(page, "Improve");
    const panel = helpPanel(page);
    await expect(panel.getByText("Couldn’t edit that text. Nothing was changed.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Replace" })).toBeDisabled();
    await panel.getByRole("button", { name: "Discard" }).click();
    await expect(editor(page)).toHaveText("Please [mock:error] help.");
  });
});

const planDialog = (page: Page) => page.getByRole("dialog", { name: "Plan my day" });

test.describe("Plan my day", () => {
  test("streams a shortlist, applies only on confirm, and Undo restores it", async ({
    page,
    browser,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Old invoice", dueDate: today(-5) });
    await insertTask(user.id, { title: "Late report", dueDate: today(-2) });
    await insertTask(user.id, { title: "Standup notes", dueDate: today() });
    await insertTask(user.id, { title: "Big proposal", priority: "HIGH" });
    await insertTask(user.id, { title: "Someday idea" }); // not a candidate

    // Another person's tasks never show up.
    const context = await newDevice(browser);
    const otherPage = await context.newPage();
    const other = (await findUser((await signUp(otherPage)).email))!;
    await insertTask(other.id, { title: "Bob's overdue", dueDate: today(-9) });

    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    const dialog = planDialog(page);
    await expect(dialog.getByText("AI-generated", { exact: true })).toBeVisible();

    const rows = dialog.getByRole("list", { name: "Proposed plan" }).getByRole("listitem");
    await expect(rows).toHaveCount(4, { timeout: 20_000 });
    await expect(rows.nth(0)).toContainText("Old invoice");
    await expect(rows.nth(1)).toContainText("Late report");
    await expect(rows.nth(2)).toContainText("Standup notes");
    await expect(rows.nth(3)).toContainText("Big proposal");
    await expect(dialog).not.toContainText("Bob's overdue");
    await expect(dialog).not.toContainText("Someday idea");
    await expect(dialog.getByText("This is a shortlist, not a schedule.")).toBeVisible();
    // The first row is the default Focus.
    await expect(dialog.getByRole("radio", { name: "Focus on Old invoice" })).toBeChecked();

    // Nothing changed yet.
    expect((await taskByTitle(user.id, "Old invoice"))[0]!.due_date).toBe(today(-5));
    expect(await focusTaskOf(user.id)).toBeNull();

    await dialog.getByRole("checkbox", { name: "Plan Big proposal" }).click();
    await dialog.getByRole("radio", { name: "Focus on Late report" }).check();
    await dialog.getByRole("button", { name: "Plan 3 tasks" }).click();

    await expect(page.getByText("Planned 3 tasks. Focus: Late report")).toBeVisible();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Old invoice"))[0]!.due_date)
      .toBe(today());
    expect((await taskByTitle(user.id, "Late report"))[0]!.due_date).toBe(today());
    expect((await taskByTitle(user.id, "Standup notes"))[0]!.due_date).toBe(today());
    expect((await taskByTitle(user.id, "Big proposal"))[0]!.due_date).toBeNull();
    const late = (await taskByTitle(user.id, "Late report"))[0]!;
    expect(await focusTaskOf(user.id)).toBe(late.id);

    await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Old invoice"))[0]!.due_date)
      .toBe(today(-5));
    await expect
      .poll(async () => (await taskByTitle(user.id, "Late report"))[0]!.due_date)
      .toBe(today(-2));
    expect((await taskByTitle(user.id, "Standup notes"))[0]!.due_date).toBe(today());
    await expect.poll(async () => focusTaskOf(user.id)).toBeNull();

    const usage = (await aiUsageOf(user.id)).filter((u) => u.feature === "PLAN_DAY");
    expect(usage).toEqual([expect.objectContaining({ status: "SUCCESS" })]);
    await context.close();
  });

  test("a clear day says so and makes no model call", async ({ page }) => {
    const { user } = await newUser(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    await expect(
      planDialog(page).getByText("Nothing needs planning. Your day is clear."),
    ).toBeVisible();
    await expect(planDialog(page).getByRole("button", { name: /^Plan/ })).toHaveCount(0);
    expect((await aiUsageOf(user.id)).filter((u) => u.feature === "PLAN_DAY")).toHaveLength(0);
  });

  test("a rate-limited person sees the wait", async ({ page }) => {
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Anything", dueDate: today() });
    await fillAiMinute(user.id, 10);
    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    await expect(planDialog(page).getByText(/Try again in \d+ seconds?/)).toBeVisible();
  });
});

test.describe("failures, limits, stopping and switching AI off", () => {
  test("Generate: a failure shows Retry and leaves the note untouched; a rate limit shows the wait", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const id = await insertNote(user.id, { title: "Steady", text: "Do not touch." });
    await page.goto(`/notes/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Generate with AI" }).click();

    await prompt(page).fill("Something [mock:error]");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText("Couldn’t write that. Nothing was changed.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(prompt(page)).toHaveValue("Something [mock:error]");
    await expect(editor(page)).toHaveText("Do not touch.");
    const failed = (await aiUsageOf(user.id)).filter((u) => u.feature === "GENERATE_CONTENT");
    expect(failed).toEqual([expect.objectContaining({ status: "PROVIDER_ERROR" })]);

    await fillAiMinute(user.id, 10);
    await prompt(page).fill("Something fine");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByText(/Try again in \d+ seconds?/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(editor(page)).toHaveText("Do not touch.");
  });

  test("Plan my day: a failure shows Retry and changes nothing", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Broken [mock:error]", dueDate: today(-2) });
    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    await expect(
      planDialog(page).getByText("Couldn’t make a plan. Nothing was changed."),
    ).toBeVisible({ timeout: 20_000 });
    await expect(planDialog(page).getByRole("button", { name: "Retry" })).toBeVisible();
    expect((await taskByTitle(user.id, "Broken [mock:error]"))[0]!.due_date).toBe(today(-2));
  });

  test("Stop keeps what was written, it can still be used, and the usage row is SUCCESS", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await page.goto("/notes/new?ai=1");
    await page.getByRole("radio", { name: "Detailed" }).click();
    await prompt(page).fill("Quarterly goals");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(draft(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("Stopped. You can still use what was written.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Stopped" })).toBeAttached();

    await page.getByRole("button", { name: "Create note" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    const notes = await notesOf(user.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content_text).toContain("Quarterly goals");
    // Stopped before the end: the last block of the full draft isn't there.
    expect(notes[0]!.content_text).not.toContain("Draft · Me");
    await expect
      .poll(async () =>
        (await aiUsageOf(user.id))
          .filter((u) => u.feature === "GENERATE_CONTENT")
          .map((u) => u.status),
      )
      .toEqual(["SUCCESS"]);
  });

  test("with AI off none of the entries exist, and direct requests get AI_DISABLED", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Plan the offsite", dueDate: today(-1) });
    const noteId = await insertNote(user.id, { title: "A note", text: "Some words here." });
    await setAiEnabled(user.id, false);

    await page.goto("/notes");
    await expect(page.getByRole("link", { name: "New note" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Write with AI" })).toHaveCount(0);

    await page.goto("/notes/new");
    await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Write with AI" })).toHaveCount(0);

    await page.goto(`/notes/${noteId}`);
    await expect(page.getByRole("button", { name: "Writing help" })).toHaveCount(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Generate with AI" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await editor(page).getByText("Some words here.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await expect(page.getByRole("button", { name: "Bold" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Improve writing" })).toHaveCount(0);

    await page.goto("/today");
    await expect(page.getByRole("button", { name: "Plan my day" })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Create" }).click();
    await expect(page.getByRole("option", { name: "New note" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Write a note with AI" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`/tasks?task=${taskId}`);
    await expect(detailPanel(page).getByLabel("Task title")).toBeVisible();
    await expect(detailPanel(page).getByRole("button", { name: "Generate with AI" })).toHaveCount(
      0,
    );

    for (const [path, data] of [
      ["/api/ai/generate-content", GEN_BODY],
      ["/api/ai/plan-day", {}],
      ["/api/ai/edit-selection", { mode: "IMPROVE", text: "Words" }],
    ] as const) {
      const response = await page.request.post(path, { data });
      expect(response.status(), path).toBe(403);
      expect((await response.json()).error.code).toBe("AI_DISABLED");
    }
  });

  test("isolation: generating for someone else's note or task is a 404", async ({
    page,
    browser,
  }) => {
    const { user } = await newUser(page);
    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    const bob = (await findUser((await signUp(bobPage)).email))!;
    const bobNote = await insertNote(bob.id, { title: "Bob's note", text: "Confidential." });
    const bobTask = await insertTask(bob.id, { title: "Bob's task" });
    for (const body of [
      { ...GEN_BODY, target: "note", targetId: bobNote },
      { ...GEN_BODY, target: "task", targetId: bobTask },
    ]) {
      const response = await page.request.post("/api/ai/generate-content", { data: body });
      expect(response.status()).toBe(404);
    }
    expect((await aiUsageOf(user.id)).filter((u) => u.feature === "GENERATE_CONTENT")).toHaveLength(
      0,
    );
    await context.close();
  });
});

const GEN_BODY = {
  target: "new",
  prompt: "Anything",
  length: "SHORT",
  withTitle: false,
  useContext: false,
} as const;

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(serious, label).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme });

    test(`the generate panel, plan dialog and edit panel have no serious violations (${colorScheme})`, async ({
      page,
    }) => {
      test.slow();
      const { user } = await newUser(page);
      await insertTask(user.id, { title: "Old invoice", dueDate: today(-5) });
      await insertTask(user.id, { title: "Due today", dueDate: today() });
      const noteId = await insertNote(user.id, { title: "Words", text: "Some words to improve." });

      await page.goto("/notes/new?ai=1");
      await generate(page, "Acme rebrand brief");
      await page.waitForLoadState("networkidle");
      await axe(page, `${colorScheme} generate panel`);

      await page.goto("/today");
      await page.getByRole("button", { name: "Plan my day" }).click();
      await expect(planDialog(page).getByRole("button", { name: /^Plan \d+ tasks?$/ })).toBeEnabled(
        {
          timeout: 20_000,
        },
      );
      await axe(page, `${colorScheme} plan dialog`);
      await page.keyboard.press("Escape");

      await page.goto(`/notes/${noteId}`);
      await selectLine(page, editor(page).getByText("Some words to improve."));
      await chooseHelp(page, "Improve");
      await expect(helpPanel(page).getByRole("button", { name: "Replace" })).toBeEnabled({
        timeout: 20_000,
      });
      await axe(page, `${colorScheme} edit panel`);
    });
  });
}

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });

  test("streaming plan rows and the growing generate panel never move", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Old invoice", dueDate: today(-5) });
    await insertTask(user.id, { title: "Due today", dueDate: today() });
    await insertTask(user.id, { title: "Big proposal", priority: "HIGH" });

    const sample = (selector: string) =>
      page.evaluate((sel) => {
        const w = window as unknown as { __moves: string[] };
        w.__moves = [];
        const identity = /^matrix\(1, 0, 0, 1, 0, 0\)$/;
        const tick = () => {
          for (const el of document.querySelectorAll<HTMLElement>(sel)) {
            const t = getComputedStyle(el).transform;
            w.__moves.push(t === "none" || identity.test(t) ? "none" : t);
          }
          if (w.__moves.length < 400) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, selector);
    const moves = () => page.evaluate(() => (window as unknown as { __moves: string[] }).__moves);

    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    await sample('[aria-label="Proposed plan"] li');
    await expect(
      planDialog(page).getByRole("list", { name: "Proposed plan" }).getByRole("listitem"),
    ).toHaveCount(3, {
      timeout: 20_000,
    });
    const rows = await moves();
    expect(rows.length).toBeGreaterThan(3);
    expect(new Set(rows)).toEqual(new Set(["none"]));
    await page.keyboard.press("Escape");

    await page.goto("/notes/new?ai=1");
    await prompt(page).fill("Quarterly goals");
    await sample(
      'section[aria-label="Generate with AI"], section[aria-label="Generate with AI"] > div',
    );
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Draft ready" })).toBeAttached({
      timeout: 20_000,
    });
    const panel = await moves();
    expect(panel.length).toBeGreaterThan(3);
    expect(new Set(panel)).toEqual(new Set(["none"]));
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  async function noSidewaysScroll(page: Page, label: string) {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const panel = document.getElementById("main-panel");
      return {
        page: doc.scrollWidth - doc.clientWidth,
        panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
      };
    });
    expect(overflow.page, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    expect(overflow.panel, `${label}: the panel scrolls sideways`).toBeLessThanOrEqual(0);
  }

  async function bigEnough(scope: Locator, label: string) {
    const heights = await scope
      .locator(
        "button:visible, [role=radio]:visible, [role=checkbox]:visible, label:has(input):visible",
      )
      .evaluateAll((els) =>
        // The draft preview is read-only (its checkboxes can't be tapped), so it is left out.
        els
          .filter((el) => !el.closest(".ProseMirror"))
          .map((el) => ({
            name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
            h: Math.round(el.getBoundingClientRect().height),
          })),
      );
    const small = heights.filter((b) => b.h < 44);
    expect(small, `${label}: controls under 44px`).toEqual([]);
  }

  test("generate panel, plan dialog and the edit sheet fit and are easy to tap", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Old invoice", dueDate: today(-5) });
    const noteId = await insertNote(user.id, { title: "Words", text: "Some words to improve." });

    await page.goto("/notes/new?ai=1");
    await expect(prompt(page)).toBeVisible();
    await noSidewaysScroll(page, "generate (ready)");
    await bigEnough(page.getByRole("region", { name: "Generate with AI" }), "generate (ready)");
    await generate(page, "Acme rebrand brief");
    await noSidewaysScroll(page, "generate (draft)");
    await bigEnough(page.getByRole("region", { name: "Generate with AI" }), "generate (draft)");

    await page.goto("/today");
    await page.getByRole("button", { name: "Plan my day" }).click();
    await expect(planDialog(page).getByRole("button", { name: /^Plan \d+ tasks?$/ })).toBeEnabled({
      timeout: 20_000,
    });
    await noSidewaysScroll(page, "plan dialog");
    await bigEnough(planDialog(page), "plan dialog");
    await page.keyboard.press("Escape");

    await page.goto(`/notes/${noteId}`);
    await selectLine(page, editor(page).getByText("Some words to improve."));
    await page.getByRole("button", { name: "Writing help" }).click();
    await page.getByRole("menuitem", { name: "Improve", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Writing help" });
    await expect(sheet.getByRole("button", { name: "Replace" })).toBeEnabled({ timeout: 20_000 });
    await noSidewaysScroll(page, "edit sheet");
    await bigEnough(sheet, "edit sheet");
    await sheet.getByRole("button", { name: "Replace" }).click();
    await expect(editor(page)).toContainText("(improved)");
  });
});
