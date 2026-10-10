import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test } from "./fixtures";
import {
  aiUsageFeatures,
  findUser,
  insertNote,
  insertNoteDoc,
  insertTask,
  linkedNoteIds,
  noteByTitle,
  setAiEnabled,
} from "./db";
import { pressLineEnd, selectToLineStart, signUp } from "./helpers";

// V2 feature 11 §6B (Ask AI and Update with AI on selected text) and the Related panel (§6). Mock
// provider only: no network, no key, no cost.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const panelOf = (page: Page) => page.getByRole("dialog", { name: "Writing help" });

/** Selects one line of text by keyboard (repeated triple clicks are unreliable in the browser). */
async function selectLine(page: Page, text: Locator) {
  await text.click();
  await pressLineEnd(page);
  await selectToLineStart(page);
}

async function chooseOpenEnded(page: Page, item: "Ask AI…" | "Update with AI…") {
  await page.getByRole("button", { name: "Improve writing" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
}

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function noteText(userId: string, title: string) {
  return (await noteByTitle(userId, title))?.content_text ?? "";
}

test.describe("Ask AI on selected text", () => {
  test("answers from the selection, changes nothing until Insert below, and one undo takes it back", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Plan",
      doc("We ship on Friday. The owner is Priya.", "Budget is fixed."),
      "We ship on Friday. The owner is Priya.\nBudget is fixed.",
    );
    await page.goto(`/notes/${id}`);
    const line = editor(page).getByText("We ship on Friday. The owner is Priya.");
    await selectLine(page, line);
    await chooseOpenEnded(page, "Ask AI…");

    const panel = panelOf(page);
    const form = panel.getByTestId("instruction-form");
    await expect(form).toContainText("We ship on Friday");
    // Quick phrases only fill the box.
    await form.getByRole("button", { name: "Explain this" }).click();
    await expect(form.getByRole("textbox")).toHaveValue("Explain this");
    await form.getByRole("textbox").fill("Who is the owner?");
    await form.getByRole("textbox").press("Enter");

    const answer = panel.getByTestId("ask-selection-answer");
    await expect(answer.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(answer).toContainText("Priya");
    await expect(answer.getByRole("button", { name: "Insert below" })).toBeVisible();
    // Reading the answer changed nothing in the note.
    await expect(editor(page).locator("p")).toHaveCount(2);

    await answer.getByRole("button", { name: "Insert below" }).click();
    await expect(panel).toHaveCount(0);
    await expect(editor(page).locator("p")).toHaveCount(3);
    await expect(editor(page).getByText(/The text says: “The owner is Priya\.”/)).toBeVisible();

    // One undo step.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page).locator("p")).toHaveCount(2);
    await expect.poll(() => noteText(user.id, "Plan")).not.toContain("The text says");

    const used = await aiUsageFeatures(user.id);
    expect(used.filter((u) => u.feature === "ASK_SELECTION")).toEqual([
      { feature: "ASK_SELECTION", status: "SUCCESS" },
    ]);
  });

  test("Continue in assistant opens the chat with the note as its chip and the selection in the first message", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Plan",
      doc("We ship on Friday. The owner is Priya."),
      "We ship on Friday. The owner is Priya.",
    );
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("We ship on Friday"));
    await chooseOpenEnded(page, "Ask AI…");
    const form = panelOf(page).getByTestId("instruction-form");
    await form.getByRole("textbox").fill("Who is the owner?");
    await form.getByRole("textbox").press("Enter");
    await expect(panelOf(page).getByTestId("ask-selection-answer")).toContainText("Priya");
    await panelOf(page).getByRole("button", { name: "Continue in assistant" }).click();

    const assistant = page.getByRole("dialog", { name: "Assistant" });
    await expect(assistant).toBeVisible();
    await expect(assistant.getByTestId("user-message")).toContainText("About this text");
    await expect(assistant.getByTestId("user-message")).toContainText("Who is the owner?");
    await expect(assistant.getByTestId("chips")).toContainText("Plan");
  });

  test("Ask another goes back to the box, Esc leaves the note as it was, and it is hidden with AI off", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Plan",
      doc("The deadline is May 3."),
      "The deadline is May 3.",
    );
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("The deadline"));
    await chooseOpenEnded(page, "Ask AI…");
    const box = panelOf(page).getByRole("textbox", { name: "Ask about this text" });
    await box.fill("deadline");
    await box.press("Enter");
    await expect(panelOf(page).getByTestId("ask-selection-answer")).toContainText("May 3");
    await panelOf(page).getByRole("button", { name: "Ask another" }).click();
    await expect(panelOf(page).getByRole("textbox", { name: "Ask about this text" })).toHaveValue(
      "",
    );
    await panelOf(page).getByRole("textbox", { name: "Ask about this text" }).press("Escape");
    await expect(panelOf(page)).toHaveCount(0);
    expect(await noteText(user.id, "Plan")).toBe("The deadline is May 3.");

    await setAiEnabled(user.id, false);
    await page.reload();
    await selectLine(page, editor(page).getByText("The deadline"));
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Improve writing" })).toHaveCount(0);
  });
});

test.describe("Update with AI", () => {
  test("rewrites only the selection with the person's words, after Replace, as one undo step", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Draft",
      doc("we ship friday", "Second line stays."),
      "we ship friday\nSecond line stays.",
    );
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("we ship friday"));
    await chooseOpenEnded(page, "Update with AI…");

    const panel = panelOf(page);
    const form = panel.getByTestId("instruction-form");
    await form.getByRole("button", { name: "More formal" }).click();
    await form.getByRole("button", { name: "Update" }).click();

    await expect(panel.getByRole("region", { name: "Before" })).toContainText("we ship friday");
    await expect(panel.getByRole("region", { name: "After" })).toContainText(
      "we ship friday (More formal)",
    );
    // Nothing is written before Replace.
    await expect(editor(page).getByText("we ship friday", { exact: true })).toBeVisible();

    // Edit the instruction (the words are kept), then send again.
    await panel.getByRole("button", { name: "Edit instruction" }).click();
    await expect(panel.getByRole("textbox", { name: "How should it change?" })).toHaveValue(
      "More formal",
    );
    await panel.getByRole("textbox", { name: "How should it change?" }).fill("shorter please");
    await panel.getByRole("textbox", { name: "How should it change?" }).press("Enter");
    await expect(panel.getByRole("region", { name: "After" })).toContainText("(shorter please)");

    await panel.getByRole("button", { name: "Replace" }).click();
    await expect(panel).toHaveCount(0);
    await expect(editor(page).getByText("we ship friday (shorter please)")).toBeVisible();
    await expect(editor(page).getByText("Second line stays.")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page).getByText("we ship friday", { exact: true })).toBeVisible();
    expect(
      (await aiUsageFeatures(user.id)).filter((u) => u.feature === "EDIT_SELECTION"),
    ).toHaveLength(2);
  });

  test("Discard changes nothing, and a failure shows Retry and leaves the text as it was", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(user.id, "Draft", doc("keep this text"), "keep this text");
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("keep this text"));
    await chooseOpenEnded(page, "Update with AI…");
    const box = panelOf(page).getByRole("textbox", { name: "How should it change?" });
    await box.fill("fail please [mock:error]");
    await box.press("Enter");
    await expect(panelOf(page).getByRole("alert")).toContainText("Nothing was changed");
    await expect(panelOf(page).getByRole("button", { name: "Retry" })).toBeVisible();
    await panelOf(page).getByRole("button", { name: "Discard" }).click();
    await expect(panelOf(page)).toHaveCount(0);
    expect(await noteText(user.id, "Draft")).toBe("keep this text");
  });

  test("works in a task description, with Ask AI too", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the brief" });
    await page.goto(`/tasks?task=${taskId}`);
    const description = page.getByRole("textbox", { name: "Task description" });
    await description.click();
    await page.keyboard.type("we ship friday");
    await selectToLineStart(page);
    await chooseOpenEnded(page, "Update with AI…");
    const box = panelOf(page).getByRole("textbox", { name: "How should it change?" });
    await box.fill("polish it");
    await box.press("Enter");
    await expect(panelOf(page).getByRole("region", { name: "After" })).toContainText(
      "we ship friday (polish it)",
    );
    await panelOf(page).getByRole("button", { name: "Replace" }).click();
    await expect(description.getByText("we ship friday (polish it)")).toBeVisible();

    await selectToLineStart(page);
    await chooseOpenEnded(page, "Ask AI…");
    await panelOf(page).getByRole("textbox", { name: "Ask about this text" }).fill("friday");
    await panelOf(page).getByRole("textbox", { name: "Ask about this text" }).press("Enter");
    await expect(panelOf(page).getByTestId("ask-selection-answer")).toContainText("friday");
  });

  test("the panel has no serious axe violations", async ({ page }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(user.id, "Axe", doc("some words here"), "some words here");
    await page.goto(`/notes/${id}`);
    await selectLine(page, editor(page).getByText("some words here"));
    await chooseOpenEnded(page, "Update with AI…");
    await expect(panelOf(page).getByTestId("instruction-form")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  });
});

test.describe("Related", () => {
  test("lists what shares words, with reasons, and links a note and a task", async ({ page }) => {
    const { user } = await newUser(page);
    const main = await insertNote(user.id, {
      title: "Checkout login failures",
      text: "Users hit login failures with OTP during checkout.",
    });
    await insertNote(user.id, {
      title: "OTP login incidents",
      text: "Several login failures with OTP codes at checkout.",
    });
    await insertNote(user.id, { title: "Gardening", text: "Tomatoes and basil." });
    const taskId = await insertTask(user.id, { title: "Fix OTP login failures at checkout" });

    await page.goto(`/notes/${main}`);
    const panel = page.getByTestId("related-panel");
    await expect(panel.getByRole("button", { name: /Related/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await panel.getByRole("button", { name: /Related/ }).click();
    const items = panel.getByTestId("related-item");
    await expect(items.filter({ hasText: "OTP login incidents" })).toContainText("Mentions “");
    await expect(items.filter({ hasText: "Fix OTP login failures at checkout" })).toBeVisible();
    await expect(items.filter({ hasText: "Gardening" })).toHaveCount(0);
    await expect(items.filter({ hasText: "Checkout login failures" })).toHaveCount(0);
    // Two notes can't be linked; a note and a task can.
    await expect(items.filter({ hasText: "OTP login incidents" }).getByRole("button")).toHaveCount(
      0,
    );
    await items
      .filter({ hasText: "Fix OTP login failures" })
      .getByRole("button", { name: "Link to this note" })
      .click();
    await expect.poll(() => linkedNoteIds(taskId)).toEqual([main]);
    await expect(items.filter({ hasText: "Fix OTP login failures" })).toHaveCount(0);
  });
});
