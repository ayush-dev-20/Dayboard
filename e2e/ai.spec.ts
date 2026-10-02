import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  aiUsageOf,
  clearDailySuggestions,
  dailySuggestionsOf,
  fillAiMinute,
  findUser,
  inboxItemsOf,
  inboxSuggestionOf,
  insertInboxItem,
  insertNote,
  insertTask,
  linkedNoteIds,
  preferencesFor,
  noteByTitle,
  taskByTitle,
  taskDescriptionText,
  todoByTitle,
} from "./db";
import { detailPanel, newDevice, signUp, today } from "./helpers";

// Everything here runs against the mock provider: no network, no key, no cost.

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const inboxRow = (page: Page, text: string) =>
  page.locator("[data-inbox-id]").filter({ hasText: text });

async function openAsk(page: Page, question: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("tab", { name: "Ask" }).click();
  const input = page.getByPlaceholder("Ask about your workspace");
  await input.fill(question);
  await input.press("Enter");
}

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("text to tasks", () => {
  test("preview, untick one, edit a title, create: exactly those tasks exist", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const itemId = await insertInboxItem(
      user.id,
      "Prepare client call notes and send agenda to Meera before Friday.\nLook into standing desks.",
    );
    await page.goto("/inbox");

    await inboxRow(page, "Prepare client call notes")
      .getByRole("button", { name: "Turn into tasks" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Turn into tasks" });
    await expect(dialog.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(3);
    await expect(dialog.getByRole("textbox").nth(0)).toHaveValue("Prepare client call notes");
    await expect(dialog.getByRole("button", { name: /^Create 3 tasks$/ })).toBeVisible();

    // Nothing exists yet.
    expect(await taskByTitle(user.id, "Prepare client call notes")).toHaveLength(0);

    await dialog.getByRole("checkbox", { name: "Include Look into standing desks" }).click();
    await dialog.getByRole("textbox").nth(1).fill("Send the agenda to Meera");
    await dialog.getByRole("button", { name: "Create 2 tasks" }).click();
    await expect(page.getByText("Created 2 tasks.")).toBeVisible();

    await expect
      .poll(async () => (await taskByTitle(user.id, "Send the agenda to Meera")).length)
      .toBe(1);
    expect(await taskByTitle(user.id, "Prepare client call notes")).toHaveLength(1);
    expect(await taskByTitle(user.id, "Send agenda to Meera")).toHaveLength(0);
    expect(await taskByTitle(user.id, "Look into standing desks")).toHaveLength(0);
    // The relative date ("before Friday") became a real date.
    expect((await taskByTitle(user.id, "Prepare client call notes"))[0]!.due_date).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    // The inbox item is now converted.
    const [item] = (await inboxItemsOf(user.id)).filter((i) => i.id === itemId);
    expect(item!.status).toBe("CONVERTED");
    expect(item!.converted_refs).toHaveLength(2);
  });

  test("a failing call shows Failed with Retry, and the rest of the page keeps working", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertInboxItem(user.id, "Send the report [mock:error]");
    await page.goto("/inbox");
    await inboxRow(page, "Send the report")
      .getByRole("button", { name: "Turn into tasks" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Turn into tasks" });
    await expect(
      dialog.getByText("Couldn’t find tasks in this. Nothing was changed."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // The inbox itself is untouched and usable.
    await expect(inboxRow(page, "Send the report")).toBeVisible();
    await inboxRow(page, "Send the report").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Archived.")).toBeVisible();
    expect((await aiUsageOf(user.id)).find((u) => u.feature === "EXTRACT_TASKS")).toMatchObject({
      status: "PROVIDER_ERROR",
    });
  });
});

test.describe("inbox suggestion", () => {
  test("Suggest shows a chip that opens the Convert dialog pre-filled; it is kept, and can be dismissed", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const todoId = await insertInboxItem(user.id, "Buy printer paper");
    const dismissId = await insertInboxItem(user.id, "Print the boarding pass");
    await page.goto("/inbox");

    await inboxRow(page, "Buy printer paper").getByRole("button", { name: "Suggest" }).click();
    const row = inboxRow(page, "Buy printer paper");
    await expect(row.getByText("Looks like a todo: “Buy printer paper”")).toBeVisible();
    await expect(row.getByText("AI-generated", { exact: true })).toBeVisible();
    // Only the suggestion is stored, never anything else.
    await expect
      .poll(() => inboxSuggestionOf(todoId))
      .toMatchObject({
        type: "TODO",
        title: "Buy printer paper",
        confidence: "high",
      });

    // It is still there after a reload.
    await page.reload();
    await expect(
      inboxRow(page, "Buy printer paper").getByText("Looks like a todo: “Buy printer paper”"),
    ).toBeVisible();

    // The chip only opens the dialog; the person still confirms.
    expect(await todoByTitle(user.id, "Buy printer paper")).toHaveLength(0);
    await inboxRow(page, "Buy printer paper").getByRole("button", { name: "Create todo" }).click();
    const dialog = page.getByRole("dialog", { name: "Convert inbox item" });
    await expect(dialog.getByLabel("Title")).toHaveValue("Buy printer paper");
    await dialog.getByRole("button", { name: "Create todo" }).click();
    await expect(page.getByText("Converted to a todo.")).toBeVisible();
    expect(await todoByTitle(user.id, "Buy printer paper")).toHaveLength(1);

    // Dismiss clears it for good.
    await inboxRow(page, "Print the boarding pass")
      .getByRole("button", { name: "Suggest" })
      .click();
    await expect(
      inboxRow(page, "Print the boarding pass").getByText(/Looks like a todo/),
    ).toBeVisible();
    await inboxRow(page, "Print the boarding pass")
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(inboxRow(page, "Print the boarding pass").getByText(/Looks like/)).toHaveCount(0);
    await expect.poll(() => inboxSuggestionOf(dismissId)).toBeNull();
  });
});

test.describe("task detail", () => {
  test("break into subtasks: untick one, add three, they appear under the task", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Plan the offsite" });
    await page.goto(`/tasks?task=${taskId}`);
    const panel = detailPanel(page);

    await panel.getByRole("button", { name: "Break into subtasks" }).click();
    const preview = panel.getByRole("region", { name: "Suggested subtasks" });
    await expect(preview.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(preview.getByRole("checkbox")).toHaveCount(4);
    // Nothing yet.
    expect((await taskByTitle(user.id, "Do the main work")).length).toBe(0);

    await preview.getByRole("checkbox", { name: "Add Gather what you need" }).click();
    await preview.getByRole("button", { name: "Add 3 subtasks" }).click();

    await expect(panel.getByText("Do the main work")).toBeVisible();
    await expect(panel.getByText("Review and finish")).toBeVisible();
    await expect(panel.getByText("Gather what you need")).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    const added = await taskByTitle(user.id, "Do the main work");
    expect(added[0]!.parent_task_id).toBe(taskId);
  });

  test("rewrite shows current beside proposed; Replace changes the description, Discard doesn't", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the launch plan" });
    await page.goto(`/tasks?task=${taskId}`);
    const panel = detailPanel(page);

    await panel.getByLabel("Task description").click();
    await page.keyboard.type("confirm the budget with Meera");
    await expect(panel.getByText("Saved", { exact: true })).toBeVisible();

    await panel.getByRole("button", { name: "Rewrite description" }).click();
    const dialog = page.getByRole("dialog", { name: "Rewrite description" });
    await expect(dialog.getByText("Current", { exact: true })).toBeVisible();
    await expect(dialog.getByText("confirm the budget with Meera").first()).toBeVisible();
    await expect(dialog.getByText("Done when it is finished and checked.")).toBeVisible();

    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await taskDescriptionText(taskId)).toBe("confirm the budget with Meera");

    await panel.getByRole("button", { name: "Rewrite description" }).click();
    await page
      .getByRole("dialog", { name: "Rewrite description" })
      .getByRole("button", { name: "Replace" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel.getByLabel("Task description")).toContainText(
      "Done when it is finished and checked.",
    );
    await expect.poll(() => taskDescriptionText(taskId)).toContain("Done when it is finished");
  });

  test("estimate is shown only and never saved; next steps can become subtasks", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the launch plan" });
    await page.goto(`/tasks?task=${taskId}`);
    const panel = detailPanel(page);

    await panel.getByRole("button", { name: "Estimate" }).click();
    const estimate = panel.getByRole("region", { name: "Estimate" });
    await expect(estimate.getByText("≤1h")).toBeVisible();
    await expect(estimate.getByText("Estimate, shown only. Not saved.")).toBeVisible();

    await panel.getByRole("button", { name: "Suggest next steps" }).click();
    const steps = panel.getByRole("region", { name: "Next steps" });
    await expect(steps.getByText("Do the first small piece")).toBeVisible();
    await steps.getByRole("button", { name: "Make subtask: Do the first small piece" }).click();
    await expect(steps.getByText("Added")).toBeVisible();
    await expect
      .poll(async () => (await taskByTitle(user.id, "Do the first small piece")).length)
      .toBe(1);
    // The estimate left no trace on the task.
    expect((await taskByTitle(user.id, "Write the launch plan"))[0]).not.toHaveProperty("estimate");
  });

  test("a failing call shows Failed with Retry and leaves the task alone", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Broken plan [mock:error]" });
    await page.goto(`/tasks?task=${taskId}`);
    const panel = detailPanel(page);
    await panel.getByRole("button", { name: "Break into subtasks" }).click();
    await expect(panel.getByText("Couldn’t suggest subtasks. Nothing was changed.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
    // The panel still works.
    await panel.getByRole("button", { name: "Priority" }).click();
    await page.getByRole("menuitemradio", { name: "High" }).click();
    await expect(panel.getByRole("button", { name: /Priority/ })).toContainText("High");
  });
});

test.describe("notes", () => {
  test("Summarize streams three labelled sections; Insert puts them in the note", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, {
      title: "Client call: kickoff",
      text: "We agreed the first milestone is the brand review. Budget is still open, so I will confirm it in writing before Friday. Next: book the design review.",
    });
    await page.goto(`/notes/${noteId}`);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Summarize" }).click();
    const summary = page.getByRole("region", { name: "Note summary" });
    await expect(summary.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(summary.getByRole("heading", { name: "Key points" })).toBeVisible();
    await expect(summary.getByRole("heading", { name: "Action items" })).toBeVisible();
    await expect(summary.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(summary.getByText("brand review").first()).toBeVisible();

    // Nothing was written to the note by summarizing.
    expect((await noteByTitle(user.id, "Client call: kickoff"))!.content_text).not.toContain(
      "Key points",
    );

    await page.getByRole("button", { name: "Insert into note" }).click();
    await expect(summary).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Key points", level: 2 })).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Client call: kickoff"))!.content_text)
      .toContain("Key points");
  });

  test("Extract tasks: the created tasks are linked to the note", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, {
      title: "Client call: kickoff",
      text: "We agreed the first milestone.\nNext: book the design review and send the revised timeline.\nMeera will share the brand principles by Oct 3.",
    });
    await page.goto(`/notes/${noteId}`);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Extract tasks" }).click();
    const dialog = page.getByRole("dialog", { name: "Tasks found in this note" });
    await expect(dialog.getByText("Created tasks are linked to this note.")).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(3);
    await expect(dialog.getByText("Owner named: Meera")).toBeVisible();
    expect(await taskByTitle(user.id, "Book the design review")).toHaveLength(0);

    await dialog.getByRole("button", { name: "Create 3 tasks and link" }).click();
    await expect(page.getByText("Created 3 tasks and linked them.")).toBeVisible();

    const book = (await taskByTitle(user.id, "Book the design review"))[0]!;
    const timeline = (await taskByTitle(user.id, "Send the revised timeline"))[0]!;
    expect(await linkedNoteIds(book.id)).toEqual([noteId]);
    expect(await linkedNoteIds(timeline.id)).toEqual([noteId]);
    await expect(page.getByRole("button", { name: /Linked tasks/ })).toContainText("3");
  });
});

test.describe("Ask my workspace", () => {
  test("streams an answer with a workspace quote and sources that open the right records", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, {
      title: "Client call: kickoff",
      text: "Budget is still open, so I will confirm it in writing before Friday.",
    });
    await insertNote(user.id, {
      title: "Website estimate",
      text: "The website estimate depends on the budget.",
    });
    await page.goto("/today");
    await openAsk(page, "What did we decide about the budget?");

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(answer.getByText("From your workspace")).toBeVisible();
    await expect(answer.getByText("Sources")).toBeVisible();
    // The model's [S1] is shown as [1].
    await expect(answer.getByText(/\[\d\]/).first()).toBeVisible();
    await expect(answer.getByText("[S1]")).toHaveCount(0);

    await answer.getByRole("link", { name: /Client call: kickoff/ }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("with nothing relevant it says so, without using the model", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Groceries", text: "Milk and oats." });
    await page.goto("/today");
    await openAsk(page, "Who won the 2010 World Cup?");
    await expect(
      page.getByText("I couldn't find anything about that in your workspace."),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByText("AI-generated", { exact: true })).toHaveCount(
      0,
    );
    // Today's own suggestion may have run; asking used nothing.
    expect((await aiUsageOf(user.id)).filter((u) => u.feature === "ASK")).toHaveLength(0);
  });

  test("a failing answer shows Failed with Retry", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Budget", text: "The budget is open." });
    await page.goto("/today");
    await openAsk(page, "What about the budget [mock:error]?");
    await expect(page.getByText("Couldn’t get an answer. Try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    // The rest of the page still works: Search mode is one click away.
    await page.getByRole("tab", { name: "Search" }).click();
    await page.getByPlaceholder("Search, ask or create").fill("Budget");
    await expect(page.getByRole("option", { name: /Budget/ }).first()).toBeVisible();
  });

  test("past the per-minute limit it says how long to wait", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Budget", text: "The budget is open." });
    await fillAiMinute(user.id, 10);
    await page.goto("/today");
    await openAsk(page, "What did we decide about the budget?");
    await expect(page.getByText(/Try again in \d+ seconds?\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect((await aiUsageOf(user.id)).at(-1)).toMatchObject({ status: "RATE_LIMITED" });
  });

  test("another person's content is never found", async ({ browser, page }) => {
    test.slow();
    const alice = await newUser(page);
    await insertNote(alice.user.id, { title: "Groceries", text: "Milk and oats." });

    const context = await newDevice(browser);
    const bobPage = await context.newPage();
    const bobAccount = await signUp(bobPage);
    const bob = (await findUser(bobAccount.email))!;
    await insertNote(bob.id, { title: "Secret plan", text: "The confidential budget is huge." });

    await page.goto("/today");
    await openAsk(page, "What is the confidential budget?");
    await expect(
      page.getByText("I couldn't find anything about that in your workspace."),
    ).toBeVisible();
    await expect(page.getByText("Secret plan")).toHaveCount(0);
    await context.close();
  });
});

test.describe("Today", () => {
  test("the daily suggestion appears after Today, refreshes once, and Today works without it", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Late one", dueDate: today(-3) });
    // Landing on Today after sign-up already made one; start the day's suggestion afresh.
    await clearDailySuggestions(user.id);
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const card = page.getByRole("region", { name: "Suggestion for today" });
    await expect(card.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(card).toContainText("1 task is overdue");
    await expect(page.getByText("One refresh per day")).toBeVisible();
    // Task titles are never sent: the stored text is built from numbers.
    expect((await dailySuggestionsOf(user.id))[0]!.text).not.toContain("Late one");

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Refreshed for today")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    expect((await dailySuggestionsOf(user.id))[0]!.refresh_count).toBe(1);

    // Reloading shows the stored one, without another model call.
    const calls = (await aiUsageOf(user.id)).length;
    await page.reload();
    await expect(card).toBeVisible();
    expect((await aiUsageOf(user.id)).length).toBe(calls);
  });

  test("Help me clean up: change an action, apply, and only the chosen tasks change", async ({
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    await insertTask(user.id, { title: "Old checklist", dueDate: today(-30) });
    await insertTask(user.id, { title: "Stale idea", dueDate: today(-25) });
    await insertTask(user.id, { title: "Send invoice", dueDate: today(-20), priority: "HIGH" });
    await insertTask(user.id, { title: "Renew domain", dueDate: today(-10) });
    await page.goto("/today");

    await page.getByRole("button", { name: "Help me clean up" }).click();
    const dialog = page.getByRole("dialog", { name: "Clean up overdue tasks" });
    await expect(dialog.getByText("Change any action before you apply.")).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(4);
    // Reschedule and Keep start ticked; Archive starts unticked.
    await expect(dialog.getByRole("checkbox", { name: "Apply to Old checklist" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "Apply to Stale idea" })).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Apply 2" })).toBeVisible();

    // Change "Stale idea" from Archive to Cancel task, and tick it.
    await dialog.getByRole("button", { name: /Action for Stale idea/ }).click();
    await page.getByRole("menuitemradio", { name: "Cancel task" }).click();
    await dialog.getByRole("checkbox", { name: "Apply to Stale idea" }).click();
    await dialog.getByRole("button", { name: "Apply 3" }).click();
    await expect(page.getByText("Updated 2 tasks.")).toBeVisible();

    const checklist = (await taskByTitle(user.id, "Old checklist"))[0]!;
    expect(checklist.due_date! > today()).toBe(true);
    expect((await taskByTitle(user.id, "Stale idea"))[0]!.status).toBe("CANCELLED");
    // Not chosen: untouched.
    const domain = (await taskByTitle(user.id, "Renew domain"))[0]!;
    expect(domain.due_date).toBe(today(-10));
    expect(domain.status).toBe("PLANNED");
    const invoice = (await taskByTitle(user.id, "Send invoice"))[0]!;
    expect(invoice.due_date).toBe(today(-20));
  });
});

test.describe("Settings and switching AI off", () => {
  test("usage is shown, and the data notice names the provider", async ({ page }) => {
    const { user } = await newUser(page);
    await insertInboxItem(user.id, "Buy printer paper");
    await page.goto("/inbox");
    await inboxRow(page, "Buy printer paper").getByRole("button", { name: "Suggest" }).click();
    await expect(inboxRow(page, "Buy printer paper").getByText(/Looks like/)).toBeVisible();

    // Today's suggestion (made when landing after sign-up) counts too.
    await expect.poll(async () => (await dailySuggestionsOf(user.id)).length).toBe(1);
    const used = (await aiUsageOf(user.id)).length;
    expect(used).toBeGreaterThanOrEqual(2);
    await page.goto("/settings/ai");
    await expect(page.getByTestId("ai-usage")).toContainText(
      `${used} of 100 AI actions used today.`,
    );
    await expect(page.getByText("Resets at midnight.")).toBeVisible();
    await expect(
      page.getByText(/Nothing is created or changed until you confirm it/),
    ).toBeVisible();
  });

  test("off hides every AI surface, and a direct request gets AI_DISABLED", async ({ page }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Plan the offsite" });
    await insertTask(user.id, { title: "Late one", dueDate: today(-3) });
    await insertInboxItem(user.id, "Buy printer paper");
    const noteId = await insertNote(user.id, { title: "A note", text: "Some words here." });
    // Let the suggestion that Today asked for after sign-up finish before counting.
    await expect.poll(async () => (await dailySuggestionsOf(user.id)).length).toBe(1);
    const usedBefore = (await aiUsageOf(user.id)).length;

    // On: the surfaces are there.
    await page.goto("/inbox");
    await expect(page.getByRole("button", { name: "Suggest" })).toBeVisible();

    await page.goto("/settings/ai");
    await page.getByRole("switch", { name: "Enable AI features" }).click();
    await expect.poll(async () => (await preferencesFor(user.id))!.ai_enabled).toBe(false);

    await page.goto("/inbox");
    await expect(page.getByText("Buy printer paper")).toBeVisible();
    await expect(page.getByRole("button", { name: "Suggest" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Turn into tasks" })).toHaveCount(0);

    await page.goto(`/tasks?task=${taskId}`);
    await expect(
      detailPanel(page)
        .getByRole("heading", { name: "Plan the offsite", level: 2 })
        .or(detailPanel(page).getByLabel("Task title")),
    ).toBeVisible();
    await expect(page.getByText("AI actions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Break into subtasks" })).toHaveCount(0);

    await page.goto(`/notes/${noteId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Summarize" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Extract tasks" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/today");
    await expect(page.getByRole("button", { name: "Help me clean up" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Suggestion for today" })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("tab", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Ask" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A direct request is refused by the server, whatever the page shows.
    for (const [path, data] of [
      ["/api/ai/extract-tasks", { text: "Send the report" }],
      ["/api/ai/ask", { question: "budget" }],
      ["/api/ai/subtasks", { taskId }],
    ] as const) {
      const response = await page.request.post(path, { data });
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe("AI_DISABLED");
    }
    expect((await page.request.get("/api/ai/daily-suggestion")).status()).toBe(403);
    expect(await aiUsageOf(user.id)).toHaveLength(usedBefore);

    // Turning it back on brings the surfaces back.
    await page.goto("/settings/ai");
    await page.getByRole("switch", { name: "Enable AI features" }).click();
    await expect.poll(async () => (await preferencesFor(user.id))!.ai_enabled).toBe(true);
    await page.goto("/inbox");
    await expect(page.getByRole("button", { name: "Suggest" })).toBeVisible();
  });

  test("direct requests need sign-in and cannot reach another person's records", async ({
    browser,
    page,
  }) => {
    test.slow();
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Private task" });
    const noteId = await insertNote(user.id, { title: "Private note", text: "Hello there." });

    const context = await newDevice(browser);
    const anon = await context.request.post("/api/ai/subtasks", { data: { taskId } });
    expect(anon.status()).toBe(401);

    const bobPage = await context.newPage();
    await signUp(bobPage);
    for (const [path, data] of [
      ["/api/ai/subtasks", { taskId }],
      ["/api/ai/task-assist", { taskId, mode: "ESTIMATE" }],
      ["/api/ai/summarize-note", { noteId }],
      ["/api/ai/action-items", { noteId }],
    ] as const) {
      const response = await bobPage.request.post(path, { data });
      expect(response.status(), path).toBe(404);
    }
    await context.close();
  });
});
