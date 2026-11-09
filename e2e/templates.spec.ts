import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertTemplate,
  journalEntriesOf,
  journalTemplateOf,
  noteByTitle,
  notesOf,
  saveTemplateElsewhere,
  templatesOf,
} from "./db";
import { signUp, today } from "./helpers";

// V3 feature 03: the Templates tab, the template editor, using a template, and the journal template.

test.use({ viewport: { width: 1440, height: 900 } });

async function newUser(page: Page) {
  const account = await signUp(page);
  return (await findUser(account.email))!;
}

/** "13 October 2026", built the way a person reads it (not with the app's own helper). */
function dateLabel(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("day")} ${part("month")} ${part("year")}`;
}

const templateEditor = (page: Page) => page.getByRole("textbox", { name: "Template content" });
const noteEditor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const toastUndo = (page: Page) =>
  page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Undo" })
    .first();

test.describe("the Templates tab", () => {
  test("adds the starters once each, opens one, edits it, and the edit survives a reload", async ({
    browser,
    page,
  }) => {
    const user = await newUser(page);
    await page.goto("/templates");
    await expect(page.getByText("Templates are starting points for your notes.")).toBeVisible();

    await page.getByRole("button", { name: "Add starter templates" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add starter templates" });
    await dialog.getByLabel(/Meeting notes/).check();
    await dialog.getByLabel(/Weekly plan/).check();
    await dialog.getByRole("button", { name: /^Add 2 selected/ }).click();
    await expect(page.getByRole("link", { name: /Meeting notes/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Weekly plan/ })).toBeVisible();

    // Already added ones are labelled and cannot be added again.
    await page.getByRole("button", { name: "Add starter templates" }).first().click();
    const again = page.getByRole("dialog", { name: "Add starter templates" });
    await expect(again.getByLabel(/Meeting notes/)).toBeDisabled();
    await expect(again.getByText("Already added").first()).toBeVisible();
    await page.keyboard.press("Escape");
    expect((await templatesOf(user.id)).map((t) => t.starter_key).sort()).toEqual([
      "meeting-notes",
      "weekly-plan",
    ]);

    await page.getByRole("link", { name: /Meeting notes/ }).click();
    await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
    const url = page.url();
    await expect(page.getByLabel("Template name")).toHaveValue("Meeting notes");
    await expect(page.getByLabel("Title pattern")).toHaveValue("Meeting: {{date}}");
    await page.getByLabel("Template name").fill("Team sync");
    await templateEditor(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("Remember the demo");
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Template name")).toHaveValue("Team sync");
    await expect(templateEditor(page)).toContainText("Remember the demo");
    await expect(templateEditor(page)).toContainText("Attendees");

    // No one else can open it.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage);
    await otherPage.goto(url);
    await expect(otherPage.getByRole("heading", { name: "We couldn't find that" })).toBeVisible();
    await other.close();
  });

  test("New template makes an empty one; a name, an emoji-free list and the filter box work", async ({
    page,
  }) => {
    const user = await newUser(page);
    await insertTemplate(user.id, { name: "Retro", text: "What went well" });
    await insertTemplate(user.id, { name: "Planning", text: "Goals" });
    await page.goto("/templates");
    await expect(page.getByRole("link", { name: /Retro/ })).toBeVisible();
    await page.getByLabel("Filter templates").fill("plan");
    await expect(page.getByRole("link", { name: /Planning/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Retro/ })).toHaveCount(0);
    await page.getByLabel("Filter templates").fill("zzz");
    await expect(page.getByText("No template matches.")).toBeVisible();

    await page.getByRole("button", { name: "New template" }).first().click();
    await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Template name")).toHaveValue("Untitled template");
    expect((await templatesOf(user.id)).length).toBe(3);
  });
});

test.describe("using a template", () => {
  test("the Notes page's From template… makes a note with the content, the date filled in and the pattern as its title; later edits to the template do not change it", async ({
    page,
  }) => {
    const user = await newUser(page);
    const id = await insertTemplate(user.id, {
      name: "Meeting",
      titlePattern: "Meeting: {{date}}",
      text: "Held on {{day}}. Keep {{ date }} as typed.",
    });
    await page.goto("/notes");
    await page.getByRole("button", { name: "More ways to start a note" }).click();
    await page.getByRole("menuitem", { name: "From template…" }).click();
    const picker = page.getByRole("dialog", { name: "New note from template" });
    await expect(picker).toBeVisible();
    await picker.getByRole("option", { name: /Meeting/ }).click();

    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    const title = `Meeting: ${dateLabel(today())}`;
    await expect(page.getByLabel("Note title")).toHaveValue(title);
    await expect(noteEditor(page)).toContainText("Keep {{ date }} as typed.");
    await expect(noteEditor(page)).not.toContainText("{{day}}");
    const made = await noteByTitle(user.id, title);
    expect(made).toBeTruthy();

    // Editing the template afterwards leaves the note alone.
    await page.goto(`/templates/${id}`);
    await templateEditor(page).click();
    await page.keyboard.type(" CHANGED");
    await expect(page.getByText("Saved")).toBeVisible();
    const after = await noteByTitle(user.id, title);
    expect(JSON.stringify(after?.content_json)).not.toContain("CHANGED");
    expect((await notesOf(user.id)).length).toBe(1);
  });

  test("Use template on its own page makes the note and opens it", async ({ page }) => {
    const user = await newUser(page);
    const id = await insertTemplate(user.id, {
      name: "Brief",
      titlePattern: "Brief",
      text: "Goal",
    });
    await page.goto(`/templates/${id}`);
    await page.getByRole("button", { name: "Use template" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(noteEditor(page)).toContainText("Goal");
    expect((await templatesOf(user.id))[0]!.version).toBe(1);
  });

  test("the command menu's New note from template works from any page", async ({ page }) => {
    const user = await newUser(page);
    await insertTemplate(user.id, {
      name: "Daily plan",
      titlePattern: "Plan {{day}}",
      text: "Top three",
    });
    await page.goto("/tasks");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Create" }).click();
    await page.getByRole("option", { name: /New note from template/ }).click();
    const picker = page.getByRole("dialog", { name: "New note from template" });
    await picker.getByLabel("Search templates").fill("daily");
    await picker.getByRole("option", { name: /Daily plan/ }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(noteEditor(page)).toContainText("Top three");
  });

  test("with no templates the picker says so and points to the Templates page", async ({
    page,
  }) => {
    await newUser(page);
    await page.goto("/notes");
    await page.getByRole("button", { name: "More ways to start a note" }).click();
    await page.getByRole("menuitem", { name: "From template…" }).click();
    const picker = page.getByRole("dialog", { name: "New note from template" });
    await expect(picker.getByText(/no templates yet/)).toBeVisible();
    await picker.getByRole("link", { name: "Go to Templates" }).click();
    await expect(page).toHaveURL(/\/templates$/);
  });
});

test.describe("the template editor", () => {
  test("Insert placeholder puts in one value as plain text, and images, files and sub-notes are not offered", async ({
    page,
  }) => {
    const user = await newUser(page);
    const id = await insertTemplate(user.id, { name: "Log", text: "Entry: " });
    await page.goto(`/templates/${id}`);
    await templateEditor(page).click();
    await page.keyboard.press("Control+End");
    await page.getByRole("button", { name: "Insert placeholder" }).click();
    await page.getByRole("menuitem", { name: /\{\{time\}\}/ }).click();
    await expect(templateEditor(page)).toContainText("Entry: {{time}}");
    await expect(page.getByText("Saved")).toBeVisible();
    expect((await templatesOf(user.id))[0]!.content_text).toContain("Entry: {{time}}");

    // The slash menu leaves out what a template may not hold.
    await templateEditor(page).click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(page.getByRole("option", { name: /Heading/ }).first()).toBeVisible();
    for (const name of [/^Image/, /^File/, /Sub-note/]) {
      await expect(page.getByRole("option", { name })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");

    // A pasted picture is not added.
    await page.evaluate(() => {
      const target = document.querySelector('[aria-label="Template content"]') as HTMLElement;
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" }));
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(templateEditor(page).locator("img")).toHaveCount(0);
  });

  test("a stale save shows the conflict banner and Keep mine saves on top", async ({ page }) => {
    const user = await newUser(page);
    const id = await insertTemplate(user.id, { name: "Shared", text: "base" });
    await page.goto(`/templates/${id}`);
    await templateEditor(page).click();
    // Another window saves first.
    await saveTemplateElsewhere(id, "elsewhere");
    await page.keyboard.type(" mine");
    await expect(page.getByText("This template changed in another window.")).toBeVisible();
    await page.getByRole("button", { name: "Keep mine" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    expect((await templatesOf(user.id))[0]!.content_text).toContain("mine");
  });
});

test.describe("the journal template", () => {
  test("Use for journal entries marks it, and the next new entry starts from it with its own day's date", async ({
    page,
  }) => {
    const user = await newUser(page);
    const id = await insertTemplate(user.id, {
      name: "Daily journal",
      text: "Morning plan for {{date}} ({{day}})",
    });
    await page.goto("/templates");
    await page.getByRole("button", { name: "Actions for Daily journal" }).click();
    await page.getByRole("menuitem", { name: "Use for journal entries" }).click();
    await expect(
      page.getByRole("link", { name: /Daily journal/ }).getByText("Journal", { exact: true }),
    ).toBeVisible();
    expect(await journalTemplateOf(user.id)).toBe(id);

    await page.goto("/journal/today");
    const editor = noteEditor(page);
    await expect(editor).toContainText(`Morning plan for ${dateLabel(today())}`);
    // The entry's own title is still the date; nothing is saved until the person writes.
    await expect(page.getByLabel("Note title")).toHaveValue(/^\w+, \d{1,2} \w+ \d{4}$/);
    expect(await journalEntriesOf(user.id)).toHaveLength(0);

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" and then more");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
    const entry = (await journalEntriesOf(user.id))[0]!;
    expect(entry.content_text).toContain(`Morning plan for ${dateLabel(today())}`);
    expect(entry.content_text).toContain("and then more");

    // Stop using it: the next new entry is empty.
    await page.goto(`/templates/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Stop using for journal entries" }).click();
    await expect.poll(() => journalTemplateOf(user.id)).toBeNull();
  });

  test("a trashed journal template gives an empty entry", async ({ page }) => {
    const user = await newUser(page);
    await insertTemplate(user.id, {
      name: "Old",
      text: "from a template",
      deleted: true,
      journal: true,
    });
    await page.goto("/journal/today");
    await expect(noteEditor(page)).toBeVisible();
    await expect(noteEditor(page)).not.toContainText("from a template");
  });
});

test.describe("Trash", () => {
  test("Delete with Undo, then delete again and restore from Trash", async ({ page }) => {
    const user = await newUser(page);
    await insertTemplate(user.id, { name: "Disposable", text: "x" });
    await page.goto("/templates");
    await page.getByRole("button", { name: "Actions for Disposable" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("Moved to Trash.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Disposable/ })).toHaveCount(0);
    await toastUndo(page).dispatchEvent("click");
    await expect(page.getByRole("link", { name: /Disposable/ })).toBeVisible();

    await page.getByRole("button", { name: "Actions for Disposable" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name: /Disposable/ })).toHaveCount(0);
    await page.goto("/trash");
    const row = page.locator("[data-trash-id]").first();
    await expect(row).toContainText("Template");
    await expect(row).toContainText("Disposable");
    await row.getByRole("button", { name: /Restore/ }).click();
    await expect.poll(async () => (await templatesOf(user.id))[0]?.deleted_at ?? null).toBeNull();
  });
});

test.describe("accessibility and phones", () => {
  test("the list, the editor and the picker have no serious problems at 1440 and 360px, light and dark", async ({
    page,
  }) => {
    test.slow();
    const user = await newUser(page);
    const id = await insertTemplate(user.id, {
      name: "Checklist",
      titlePattern: "Check {{date}}",
      text: "One",
    });
    for (const [width, height] of [
      [1440, 900],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        for (const path of ["/templates", `/templates/${id}`, "/notes"]) {
          await page.goto(path);
          if (path === "/notes") {
            await page.getByRole("button", { name: "More ways to start a note" }).click();
            await page.getByRole("menuitem", { name: "From template…" }).click();
            await expect(page.getByRole("option", { name: /Checklist/ })).toBeVisible();
          } else if (path === "/templates") {
            await expect(page.getByRole("link", { name: /Checklist/ })).toBeVisible();
          } else {
            await expect(templateEditor(page)).toBeVisible();
          }
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            serious.map((v) => `${width} ${scheme} ${path}: ${v.id}`),
            JSON.stringify(serious.map((v) => v.nodes[0]?.html)),
          ).toEqual([]);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(
            overflow,
            `${width} ${scheme} ${path}: ${overflow}px wider than the screen`,
          ).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  test("on a phone, Templates is under More", async ({ page }) => {
    await newUser(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/more");
    await page.getByRole("link", { name: "Templates" }).click();
    await expect(page).toHaveURL(/\/templates$/);
  });
});
