import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { findUser, insertTask, noteByTitle, journalEntriesOf } from "./db";
import { signUp } from "./helpers";

// Dictation into the editors and capture boxes. Headless Chrome has no speech engine, so a fake recogniser stands in for
// the browser's: the test "says" sentences and the app formats and inserts what it hears.

test.use({ viewport: { width: 1280, height: 800 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

/** Installs a fake recogniser before the app loads. `say` is a phrase the browser finished hearing. */
async function withSpeech(page: Page, options: { error?: string } = {}) {
  await page.addInitScript((failWith) => {
    const w = window as unknown as Record<string, unknown>;
    w.__sessions = 0;
    class FakeRecognition {
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      start() {
        (w.__sessions as number) += 1;
        w.__current = this;
        if (failWith) setTimeout(() => this.onerror?.({ error: failWith }), 0);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {}
    }
    // Chrome has both names, and the app prefers the standard one.
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    w.__say = (text: string, final = true) => {
      const r = w.__current as FakeRecognition;
      r.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: final, 0: { transcript: text }, length: 1 }],
      });
    };
  }, options.error ?? null);
}

const say = (page: Page, text: string, final = true) =>
  page.evaluate(
    ([t, f]) =>
      (window as unknown as { __say: (a: string, b: boolean) => void }).__say(
        t as string,
        f as boolean,
      ),
    [text, final],
  );

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const dictate = (page: Page) => page.getByRole("button", { name: "Dictate", exact: true });
const stop = (page: Page) => page.getByRole("button", { name: "Stop dictating" });

test.describe("dictating into a note", () => {
  test("types what is heard with capitals and spoken punctuation, and the note saves it", async ({
    page,
  }) => {
    const user = await newUser(page);
    await withSpeech(page);
    await page.goto("/notes/new");
    await page.getByLabel("Note title").fill("Groceries");
    await page.keyboard.press("Enter"); // into the text
    await dictate(page).click();
    await expect(stop(page)).toBeVisible();

    await say(page, "buy milk", false); // still being heard: shown, not typed
    await expect(page.getByText("buy milk")).toBeVisible();
    await expect(editor(page)).not.toContainText("milk");

    await say(page, "buy milk comma eggs comma and bread period");
    await say(page, "new paragraph call mom question mark");
    await expect(editor(page)).toContainText("Buy milk, eggs, and bread.");
    await expect(editor(page).locator("p").nth(1)).toHaveText("Call mom?");

    await stop(page).click();
    await expect(dictate(page)).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
    const saved = await noteByTitle(user.id, "Groceries");
    expect(saved?.content_text).toContain("Buy milk, eggs, and bread.");
    expect(saved?.content_text).toContain("Call mom?");
  });

  test("continues a sentence with one space and a lower-case word, and Undo takes a phrase back", async ({
    page,
  }) => {
    await newUser(page);
    await withSpeech(page);
    await page.goto("/notes/new");
    await page.getByLabel("Note title").fill("Plan");
    await page.keyboard.press("Enter");
    await page.keyboard.type("We should");
    await dictate(page).click();
    await say(page, "go early");
    await expect(editor(page)).toContainText("We should go early");
    await say(page, "i think");
    await expect(editor(page)).toContainText("We should go early I think");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page)).not.toContainText("I think");
  });

  test("a new bullet is started by a spoken new paragraph inside a list", async ({ page }) => {
    await newUser(page);
    await withSpeech(page);
    await page.goto("/notes/new");
    await page.getByLabel("Note title").fill("List");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Bulleted list" }).click();
    await dictate(page).click();
    await say(page, "apples new paragraph pears");
    await expect(editor(page).getByRole("listitem")).toHaveCount(2);
    await expect(editor(page).getByRole("listitem").nth(1)).toHaveText("Pears");
  });

  test("works in a journal entry too", async ({ page }) => {
    const user = await newUser(page);
    await withSpeech(page);
    await page.goto("/journal/today");
    await editor(page).click();
    await dictate(page).click();
    await say(page, "today went well period");
    await expect(editor(page)).toContainText("Today went well.");
    await expect(page.getByText("Saved")).toBeVisible();
    expect((await journalEntriesOf(user.id))[0]?.content_text).toContain("Today went well.");
  });
});

test.describe("dictating into a task description", () => {
  test("the description's toolbar has the microphone and types into the description", async ({
    page,
  }) => {
    const user = await newUser(page);
    await insertTask(user.id, { title: "Plan the trip" });
    await withSpeech(page);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Plan the trip", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Task detail" });
    await panel.getByRole("textbox", { name: "Task description" }).click();
    await panel.getByRole("button", { name: "Dictate", exact: true }).click();
    await say(page, "book flights comma then hotel");
    await expect(panel.getByRole("textbox", { name: "Task description" })).toContainText(
      "Book flights, then hotel",
    );
  });
});

test.describe("dictating into the capture boxes", () => {
  test("the Inbox box takes dictation, and a spoken new line is a new line", async ({ page }) => {
    await newUser(page);
    await withSpeech(page);
    await page.goto("/inbox");
    const box = page.getByLabel("Capture a thought");
    await box.click();
    await dictate(page).click();
    await say(page, "call the plumber new line book the dentist");
    await expect(box).toHaveValue("Call the plumber\nBook the dentist");
  });

  test("Today's one-line box takes dictation without a line break", async ({ page }) => {
    await newUser(page);
    await withSpeech(page);
    await page.goto("/today");
    const box = page.getByLabel("Capture to Inbox");
    await box.click();
    await dictate(page).click();
    await say(page, "pay rent new line tomorrow");
    await expect(box).toHaveValue("Pay rent Tomorrow");
  });
});

test.describe("when dictation is not possible", () => {
  test("no microphone is offered in a browser without speech recognition", async ({ page }) => {
    await newUser(page);
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    });
    await page.goto("/notes/new");
    await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
    await expect(dictate(page)).toHaveCount(0);
    await page.goto("/inbox");
    await expect(page.getByLabel("Capture a thought")).toBeVisible();
    await expect(dictate(page)).toHaveCount(0);
  });

  test("a refused microphone says so and stops listening", async ({ page }) => {
    await newUser(page);
    await withSpeech(page, { error: "not-allowed" });
    await page.goto("/notes/new");
    await page.getByLabel("Note title").fill("No mic");
    await page.keyboard.press("Enter");
    await dictate(page).click();
    await expect(page.getByText(/Dictation needs the microphone/)).toBeVisible();
    await expect(dictate(page)).toBeVisible();
  });
});
