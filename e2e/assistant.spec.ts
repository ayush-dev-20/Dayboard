import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test } from "./fixtures";
import {
  aiUsageFeatures,
  auditRows,
  findUser,
  insertNote,
  insertTask,
  setAiEnabled,
  taskTitlesOf,
} from "./db";
import { signUp } from "./helpers";

// V2 feature 11 against the mock provider: no network, no key, no cost. Conversations are stored in
// this browser only; nothing the assistant suggests is written until the person confirms.

test.use({ viewport: { width: 1280, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const chat = (page: Page) => page.getByTestId("assistant-chat");
const composer = (page: Page) => chat(page).getByRole("textbox", { name: "Message the assistant" });

/** Sends a question and waits for the answer to finish (Stop goes away), so the next can follow. */
async function ask(page: Page, question: string) {
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(chat(page).getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(chat(page).getByTestId("user-message").last()).toContainText(
    question.replace(" [mock:error]", ""),
  );
}

test.describe("the Assistant page", () => {
  test("answers from the workspace, cites a source that opens, and says why it was found", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, {
      title: "Login failures",
      text: "Users report login failures with OTP codes at checkout.",
    });
    await page.goto("/assistant");
    await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible();

    await ask(page, "What did I write about login failures?");
    const answer = chat(page).getByTestId("assistant-message");
    await expect(answer.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(answer).toContainText("Login failures");
    await expect(chat(page).getByTestId("tool-line")).toContainText("Searched your workspace");

    // The source is a link; "Why" shows what the server recorded, not model text.
    const source = chat(page).getByTestId("source");
    await expect(source.getByRole("link", { name: /Login failures/ })).toBeVisible();
    await source.getByRole("button", { name: "Why" }).click();
    await expect(chat(page).getByTestId("source-why")).toContainText("login");
    await expect(chat(page).getByTestId("source-why")).toContainText("OTP codes");

    // The conversation is stored in this browser: it is still there after a reload.
    await page.reload();
    await expect(chat(page).getByTestId("user-message")).toContainText("login failures");
    await expect(chat(page).getByTestId("assistant-message")).toContainText("Login failures");

    await chat(page)
      .getByRole("link", { name: /Login failures/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
  });

  test("a follow-up uses the thread, and a question with no match says so", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Budget review", text: "Hosting costs went up in March." });
    await page.goto("/assistant");
    await ask(page, "budget review");
    await expect(chat(page).getByTestId("assistant-message")).toHaveCount(1);
    await ask(page, "hosting costs");
    await expect(chat(page).getByTestId("assistant-message")).toHaveCount(2);
    await expect(chat(page).getByTestId("user-message")).toHaveCount(2);
    await ask(page, "zebrafish quantum marmalade");
    await expect(
      chat(page).getByText("I couldn't find anything about that in your workspace."),
    ).toBeVisible();
  });

  test("conversations: new chat, rename, delete, clear all; stored on this device only", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Alpha note", text: "alpha content here" });
    await page.goto("/assistant");
    await ask(page, "alpha content");
    const rail = page.getByRole("navigation", { name: "Conversations" });
    await expect(rail.getByText("alpha content")).toBeVisible();
    await expect(rail.getByText("Stored on this device only.")).toBeVisible();

    await rail.getByRole("button", { name: "New chat" }).click();
    await expect(chat(page).getByTestId("assistant-empty")).toBeVisible();
    await ask(page, "second thread");
    await expect(rail.getByRole("listitem")).toHaveCount(2);

    await rail.getByRole("button", { name: /Options for second thread/ }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Conversation name").fill("Renamed chat");
    await page.keyboard.press("Enter");
    await expect(rail.getByText("Renamed chat")).toBeVisible();

    await rail.getByRole("button", { name: /Options for Renamed chat/ }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(rail.getByRole("listitem")).toHaveCount(1);

    await rail.getByRole("button", { name: "Clear all conversations" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear all" }).click();
    await expect(rail.getByText("No conversations yet.")).toBeVisible();
  });

  test("signing out clears the conversations, and nothing is stored on the server", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Private plan", text: "secret launch codename Bluebird" });
    await page.goto("/assistant");
    await ask(page, "secret launch codename");
    await expect(chat(page).getByTestId("assistant-message")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some((k) => k.startsWith("dayboard:assistant:")),
        ),
      )
      .toBe(true);

    // The server kept a count of the action, and no text.
    await expect
      .poll(async () => (await aiUsageFeatures(user.id)).filter((r) => r.feature === "ASSISTANT"))
      .toEqual([{ feature: "ASSISTANT", status: "SUCCESS" }]);

    await page
      .getByRole("button", { name: /Test User|account/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/sign-in/);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("dayboard:assistant:")),
      ),
    ).toEqual([]);
  });

  test("a failure shows Retry and leaves the workspace unchanged; AI off hides the page and the menu", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Anything", text: "some text" });
    await page.goto("/assistant");
    await ask(page, "anything [mock:error]");
    await expect(chat(page).getByRole("alert")).toContainText("Nothing was changed");
    await expect(chat(page).getByRole("button", { name: "Retry" })).toBeVisible();
    expect(await taskTitlesOf(user.id)).toEqual([]);

    await setAiEnabled(user.id, false);
    await page.reload();
    await expect(page.getByText("The assistant is turned off.")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Assistant" }),
    ).toHaveCount(0);
  });
});

test.describe("suggestions: nothing is written until the person confirms", () => {
  test("turn a note into tasks: untick one, edit a title, confirm; exactly those exist, one audit row", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, {
      title: "Meeting notes",
      text: "We need to send the agenda.\nPriya will book the venue.\nSomeone should review the budget.",
    });
    await page.goto("/assistant");
    // Point the assistant at the note with Add item…, then ask.
    await chat(page).getByRole("button", { name: "Add item to ask about" }).click();
    await page.getByRole("combobox", { name: "Search notes, tasks and projects" }).fill("Meeting");
    await page.getByRole("option", { name: /Meeting notes/ }).click();
    await expect(chat(page).getByTestId("chips")).toContainText("Meeting notes");
    await ask(page, "Turn this note into tasks");

    const card = chat(page).getByTestId("proposal-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("AI suggestion")).toBeVisible();
    // Nothing exists yet.
    expect(await taskTitlesOf(user.id)).toEqual([]);

    const titles = card.getByRole("textbox", { name: /Task title/ });
    const count = await titles.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await titles.first().fill("Edited first task");
    await card
      .getByRole("checkbox", { name: /Include/ })
      .last()
      .click();
    const confirm = card.getByRole("button", { name: new RegExp(`^Create ${count - 1} tasks?$`) });
    await confirm.click();
    await expect(chat(page).getByTestId("proposal-applied")).toContainText(`Created ${count - 1}`);

    const made = await taskTitlesOf(user.id);
    expect(made).toHaveLength(count - 1);
    expect(made).toContain("Edited first task");
    const [row, ...rest] = await auditRows(user.id);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      source: "ASSISTANT",
      action: "tasks.create",
      summary: `Created ${count - 1} ${count - 1 === 1 ? "task" : "tasks"}`,
    });
    expect(JSON.stringify(row)).not.toMatch(/Edited first task|agenda|venue/);
    // The new tasks are linked to the note.
    await page.goto(`/notes/${noteId}`);
  });

  test("dismissing a suggestion changes nothing; an overdue reschedule shows before and after", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const yesterday = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    await insertTask(user.id, { title: "Late invoice", dueDate: yesterday });
    await page.goto("/assistant");
    await ask(page, "reschedule my overdue tasks");
    const card = chat(page).getByTestId("proposal-card");
    await expect(card.getByText("Late invoice")).toBeVisible();
    await expect(card.getByText("Due")).toBeVisible();
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(chat(page).getByTestId("proposal-dismissed")).toBeVisible();
    expect(await auditRows(user.id)).toEqual([]);

    // The suggestion is still dismissed after a reload.
    await page.reload();
    await expect(chat(page).getByTestId("proposal-dismissed")).toBeVisible();
  });

  test("applying in one tab marks the suggestion applied in the other, and it cannot be applied twice", async ({
    page,
    context,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Twice", text: "We need to send the report." });
    await page.goto("/assistant");
    await chat(page).getByRole("button", { name: "Add item to ask about" }).click();
    await page.getByRole("option", { name: /Twice/ }).click();
    await ask(page, "turn this into tasks");
    await expect(chat(page).getByTestId("proposal-card")).toBeVisible();

    const other = await context.newPage();
    await other.goto("/assistant");
    await expect(other.getByTestId("proposal-card")).toBeVisible();
    await chat(page)
      .getByTestId("proposal-card")
      .getByRole("button", { name: /^Create/ })
      .click();
    await expect(chat(page).getByTestId("proposal-applied")).toBeVisible();
    // The other tab follows the stored thread: nothing left to confirm there.
    await expect(other.getByTestId("proposal-applied")).toBeVisible();
    await expect(other.getByTestId("proposal-card")).toHaveCount(0);
    expect(await taskTitlesOf(user.id)).toHaveLength(1);
  });
});

test.describe("Open in assistant from the command menu", () => {
  test("continues the Ask answer as a conversation", async ({ page }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Roadmap", text: "Roadmap includes billing and hosting." });
    await page.goto("/today");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Ask" }).click();
    const input = page.getByPlaceholder("Ask about your workspace");
    await input.fill("roadmap billing");
    await input.press("Enter");
    await page.getByRole("button", { name: "Open in assistant" }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await expect(chat(page).getByTestId("user-message")).toContainText("roadmap billing");
    await expect(chat(page).getByTestId("assistant-message")).toContainText("Roadmap");
    await ask(page, "billing again");
    await expect(chat(page).getByTestId("assistant-message")).toHaveCount(2);
  });
});

test.describe("accessibility and small screens", () => {
  test("the page, a streamed answer and a suggestion have no serious axe violations (light, dark) and fit 360px", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    await insertNote(user.id, { title: "Planning", text: "We need to send the plan to Priya." });
    await page.goto("/assistant");
    await chat(page).getByRole("button", { name: "Add item to ask about" }).click();
    await page.getByRole("option", { name: /Planning/ }).click();
    await ask(page, "turn this into tasks");
    await expect(chat(page).getByTestId("proposal-card")).toBeVisible();

    async function scan(label: string) {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.help}`),
        label,
      ).toEqual([]);
    }
    await scan("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await scan("dark");

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
