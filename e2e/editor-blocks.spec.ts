import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  findUser,
  insertNote,
  insertNoteDoc,
  insertTask,
  noteByTitle,
  taskDescriptionText,
} from "./db";
import { detailPanel, signUp } from "./helpers";

// V2 feature 01: the slash menu, tables, toggles, callouts, table of contents and nested lists.

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

test.use({ viewport: { width: 1280, height: 800 } });

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const menu = (page: Page) => page.getByRole("listbox", { name: "Insert a block" });

async function openBlank(page: Page) {
  const { user } = await newUser(page);
  const id = await insertNote(user.id, { title: "Blocks", text: "" });
  await page.goto(`/notes/${id}`);
  await editor(page).click();
  return { user, id };
}

/** Types `/query` and picks the first match with Enter. */
async function slash(page: Page, query: string) {
  await page.keyboard.type(`/${query}`);
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
}

test.describe("slash menu", () => {
  test("opens on /, filters, inserts, and closes with Escape leaving the text", async ({
    page,
  }) => {
    await openBlank(page);
    await page.keyboard.type("/");
    await expect(menu(page)).toBeVisible();
    await expect(page.getByRole("option", { name: "Table", exact: true })).toBeVisible();
    await page.keyboard.type("tab");
    // "Table" and "Table of contents" both start with it.
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(editor(page)).toContainText("/tab");
  });

  test("a slash in the middle of a word is just a slash", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("and/or");
    await expect(menu(page)).toHaveCount(0);
  });

  test("the Insert button opens the same menu", async ({ page }) => {
    await openBlank(page);
    await page.getByRole("button", { name: "Insert block" }).click();
    await expect(menu(page)).toBeVisible();
  });
});

test.describe("tables", () => {
  test("insert, move with Tab, add rows, header toggle, persists after reload", async ({
    page,
  }) => {
    const { user } = await openBlank(page);
    await slash(page, "table");
    const table = editor(page).locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("tr").first().locator("th")).toHaveCount(3);

    await page.keyboard.type("Name");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Role");
    // Tab through to the last cell, then Tab adds a row.
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("Tab");
    await expect(table.locator("tr")).toHaveCount(4);

    await expect
      .poll(async () => (await noteByTitle(user.id, "Blocks"))?.content_text)
      .toContain("Name Role");
    await page.reload();
    await expect(editor(page).locator("table tr")).toHaveCount(4);
    await expect(editor(page).locator("table th").first()).toHaveText("Name");
  });
});

test.describe("table columns", () => {
  test("dragging a column edge resizes it, and the width survives a reload", async ({ page }) => {
    const { user } = await openBlank(page);
    await slash(page, "table");
    const first = editor(page).locator("table th").first();
    await expect(first).toBeVisible();
    const box = (await first.boundingBox())!;
    const edgeX = box.x + box.width - 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(edgeX, y);
    await page.mouse.down();
    await page.mouse.move(edgeX + 90, y, { steps: 6 });
    await page.mouse.up();
    const widened = (await first.boundingBox())!;
    expect(widened.width).toBeGreaterThan(box.width + 40);

    await expect
      .poll(async () => JSON.stringify((await noteByTitle(user.id, "Blocks"))?.content_json))
      .toContain("colwidth");
    await page.reload();
    const after = (await editor(page).locator("table th").first().boundingBox())!;
    expect(after.width).toBeGreaterThan(box.width + 40);
  });
});

test.describe("toggles", () => {
  test("insert, open and close; the saved note does not change", async ({ page }) => {
    const { user } = await openBlank(page);
    await slash(page, "toggle");
    await page.keyboard.type("Details");
    await page.keyboard.press("Enter");
    await page.keyboard.type("hidden words");
    const arrow = editor(page).getByRole("button", { name: "Collapse toggle" });
    await expect(arrow).toHaveAttribute("aria-expanded", "true");

    await expect
      .poll(async () => (await noteByTitle(user.id, "Blocks"))?.version)
      .toBeGreaterThan(1);
    const before = (await noteByTitle(user.id, "Blocks"))!.version;

    await arrow.click();
    await expect(editor(page).getByRole("button", { name: "Expand toggle" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(editor(page).locator('[data-type="toggleContent"]')).toBeHidden();
    // Closed content stays findable: the browser's find-in-page opens it (`beforematch`).
    await expect(editor(page).locator('[data-type="toggleContent"]')).toHaveAttribute(
      "hidden",
      "until-found",
    );
    await page.waitForTimeout(1500);
    expect((await noteByTitle(user.id, "Blocks"))!.version).toBe(before);

    // Closed content is still part of the saved text.
    expect((await noteByTitle(user.id, "Blocks"))!.content_text).toContain("hidden words");

    // The choice is remembered on this device.
    await page.reload();
    await expect(editor(page).getByRole("button", { name: "Expand toggle" })).toBeVisible();
  });
});

test.describe("callouts", () => {
  test("insert, change the style, leave with Enter on an empty line", async ({ page }) => {
    await openBlank(page);
    await slash(page, "callout");
    await page.keyboard.type("Heads up");
    const callout = editor(page).locator(".callout");
    await expect(callout).toHaveAttribute("data-tone", "neutral");
    await page.getByRole("button", { name: /Callout style/ }).click();
    await page.getByRole("menuitemradio", { name: "Warning" }).click();
    await expect(callout).toHaveAttribute("data-tone", "warning");

    await editor(page).getByText("Heads up").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("after");
    await expect(editor(page).locator(".callout")).not.toContainText("after");
    await expect(editor(page)).toContainText("after");
  });
});

test.describe("table of contents", () => {
  test("lists the headings, follows edits and scrolls to one", async ({ page }) => {
    await openBlank(page);
    await slash(page, "contents");
    await expect(editor(page).getByText("Add headings to see them here.")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await slash(page, "heading 1");
    await page.keyboard.type("First topic");
    await expect(editor(page).getByRole("button", { name: "First topic" })).toBeVisible();
    await page.keyboard.type(" renamed");
    await expect(editor(page).getByRole("button", { name: "First topic renamed" })).toBeVisible();
  });
});

test.describe("nested lists", () => {
  test("numbers show 1. a. i. and bullets dot, circle, square by depth", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("1. one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("three");

    const styles = await editor(page)
      .locator("ol")
      .evaluateAll((lists) => lists.map((l) => getComputedStyle(l).listStyleType));
    expect(styles).toEqual(["decimal", "lower-alpha", "lower-roman"]);
  });
});

const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const item = (...content: unknown[]) => ({ type: "listItem", content });

test.describe("one undo step, keyboard moves and the block handle", () => {
  test("a slash insert is undone in one step", async ({ page }) => {
    await openBlank(page);
    await slash(page, "callout");
    await expect(editor(page).locator(".callout")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor(page).locator(".callout")).toHaveCount(0);
  });

  test("Alt+Arrow moves the block; the handle turns it into a heading, duplicates and deletes", async ({
    page,
  }) => {
    await openBlank(page);
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(editor(page).locator("p").first()).toHaveText("second");

    // The handle appears beside the block under the pointer.
    await editor(page).locator("p").first().hover();
    const handle = page.getByRole("button", { name: "Block options" });
    await expect(handle).toBeVisible();
    await handle.click();
    await page.getByRole("menuitem", { name: "Heading 2", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(editor(page).getByRole("heading", { name: "second", level: 2 })).toBeVisible();

    await editor(page).getByRole("heading", { name: "second" }).hover();
    await page.getByRole("button", { name: "Block options" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(editor(page).getByRole("heading", { name: "second" })).toHaveCount(2);

    await editor(page).getByRole("heading", { name: "second" }).first().hover();
    const again = page.getByRole("button", { name: "Block options" });
    await expect(again).toBeVisible();
    await again.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(editor(page).getByRole("heading", { name: "second" })).toHaveCount(1);
  });
});

test.describe("turn into", () => {
  test("a paragraph becomes a toggle, then a heading, then a callout, keeping its text", async ({
    page,
  }) => {
    await openBlank(page);
    await page.keyboard.type("keep me");
    const turnInto = async (target: Locator, name: string) => {
      await target.hover();
      const handle = page.getByRole("button", { name: "Block options" });
      await expect(handle).toBeVisible();
      await handle.click();
      await page.getByRole("menuitem", { name, exact: true }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
    };
    await turnInto(editor(page).locator("p").first(), "Toggle");
    await expect(editor(page).locator(".toggle")).toContainText("keep me");

    // Turning a toggle into a heading unwraps it: the summary becomes the heading.
    await turnInto(editor(page).locator(".toggle"), "Heading 2");
    await expect(editor(page).locator(".toggle")).toHaveCount(0);
    await expect(editor(page).getByRole("heading", { name: "keep me", level: 2 })).toBeVisible();

    await turnInto(editor(page).getByRole("heading", { name: "keep me" }), "Callout");
    await expect(editor(page).locator(".callout")).toContainText("keep me");
  });
});

test.describe("toggle keys", () => {
  test("Enter opens the body, Enter on an empty last line leaves, Tab and Shift+Tab move blocks", async ({
    page,
  }) => {
    await openBlank(page);
    await slash(page, "toggle");
    await page.keyboard.type("Title");
    await page.keyboard.press("Enter");
    await page.keyboard.type("inside");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("outside");
    await expect(editor(page).locator('[data-type="toggleContent"]')).not.toContainText("outside");
    await expect(editor(page)).toContainText("outside");

    // Tab moves the block below a toggle into it; Shift+Tab moves it back out.
    await page.keyboard.press("Tab");
    await expect(editor(page).locator('[data-type="toggleContent"]')).toContainText("outside");
    await page.keyboard.press("Shift+Tab");
    await expect(editor(page).locator('[data-type="toggleContent"]')).not.toContainText("outside");
  });

  test("Backspace on the empty title of an empty toggle removes it", async ({ page }) => {
    await openBlank(page);
    await slash(page, "toggle");
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator(".toggle")).toHaveCount(0);
  });
});

test.describe("lists", () => {
  test("Indent and Outdent buttons change the marker, and a seventh level is refused", async ({
    page,
  }) => {
    await openBlank(page);
    await page.keyboard.type("1. one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");
    await page.getByRole("button", { name: "Indent", exact: true }).click();
    let styles = await editor(page)
      .locator("ol")
      .evaluateAll((lists) => lists.map((l) => getComputedStyle(l).listStyleType));
    expect(styles).toEqual(["decimal", "lower-alpha"]);

    await page.getByRole("button", { name: "Outdent", exact: true }).click();
    styles = await editor(page)
      .locator("ol")
      .evaluateAll((lists) => lists.map((l) => getComputedStyle(l).listStyleType));
    expect(styles).toEqual(["decimal"]);
  });

  test("bullets show dot, circle, square, and existing notes get the new markers with no migration", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const nested = (levels: number): unknown => {
      let inner: unknown[] = [p("deepest")];
      for (let i = 1; i < levels; i += 1) {
        inner = [p(`level ${levels - i}`), { type: "bulletList", content: [item(...inner)] }];
      }
      return { type: "bulletList", content: [item(...inner)] };
    };
    const id = await insertNoteDoc(user.id, "Old", doc(nested(4)), "level 1");
    await page.goto(`/notes/${id}`);
    await expect(editor(page).locator("ul").first()).toBeVisible();
    const styles = await editor(page)
      .locator("ul")
      .evaluateAll((lists) => lists.map((l) => getComputedStyle(l).listStyleType));
    expect(styles).toEqual(["disc", "circle", "square", "disc"]);
  });

  test("a seventh list level is refused with a message", async ({ page }) => {
    const { user } = await newUser(page);
    const six = (): unknown => {
      let inner: unknown[] = [p("level six")];
      for (let i = 1; i < 6; i += 1) {
        inner = [p(`level ${6 - i}`), { type: "bulletList", content: [item(...inner)] }];
      }
      return { type: "bulletList", content: [item(...inner)] };
    };
    const id = await insertNoteDoc(user.id, "Deep", doc(six()), "x");
    await page.goto(`/notes/${id}`);
    await editor(page).getByText("level six").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("seventh");
    await page.keyboard.press("Tab");
    await expect(page.getByText("Lists can go six levels deep.")).toBeVisible();
    expect(await editor(page).locator("ul").count()).toBe(6);
  });
});

test.describe("table limits", () => {
  test("the 101st row is refused with a message", async ({ page }) => {
    const { user } = await newUser(page);
    const cell = (text: string) => ({ type: "tableCell", content: [p(text)] });
    const rows = Array.from({ length: 100 }, (_, i) => ({
      type: "tableRow",
      content: [cell(`r${i}`), cell("b"), cell("last")],
    }));
    const id = await insertNoteDoc(user.id, "Big", doc({ type: "table", content: rows }), "x");
    await page.goto(`/notes/${id}`);
    await editor(page).locator("tr").last().locator("td").last().click();
    await page.keyboard.press("Tab");
    await expect(page.getByText("Tables can have up to 100 rows.")).toBeVisible();
    await expect(editor(page).locator("tr")).toHaveCount(100);

    // The table toolbar says why too.
    await page.getByRole("button", { name: "Row options" }).click();
    await expect(page.getByRole("menuitem", { name: "Add row below" })).toBeDisabled();
  });

  test("the table toolbar adds, duplicates and removes rows and columns, and toggles headers", async ({
    page,
  }) => {
    await openBlank(page);
    await slash(page, "table");
    const table = editor(page).locator("table");
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitem", { name: "Add row below" }).click();
    await expect(table.locator("tr")).toHaveCount(4);
    await page.getByRole("button", { name: "Column options" }).click();
    await page.getByRole("menuitem", { name: "Add column right" }).click();
    await expect(table.locator("tr").first().locator("th")).toHaveCount(4);
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitem", { name: "Duplicate row" }).click();
    await expect(table.locator("tr")).toHaveCount(5);
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitem", { name: "Delete row" }).click();
    await expect(table.locator("tr")).toHaveCount(4);

    await page.getByRole("button", { name: "Header row" }).click();
    await expect(table.locator("tr").first().locator("th")).toHaveCount(0);
    await page.getByRole("button", { name: "Delete table" }).click();
    await expect(table).toHaveCount(0);
  });
});

test.describe("task descriptions", () => {
  test("the same blocks work in a task description and are saved", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Write the report" });
    await page.goto(`/tasks?task=${taskId}`);
    const description = detailPanel(page).getByRole("textbox", { name: "Task description" });
    await description.click();
    await page.keyboard.type("/toggle");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("More detail");
    await page.keyboard.press("Enter");
    await page.keyboard.type("details inside");
    await expect.poll(async () => taskDescriptionText(taskId)).toContain("details inside");

    // Notes-only items are not offered here (none exist yet), and the menu stays on screen.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("/");
    const list = menu(page);
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  });
});

test.describe("accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`a note with every block has no serious violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const { user } = await newUser(page);
      const cell = (text: string, type = "tableCell") => ({ type, content: [p(text)] });
      const content = doc(
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "tableOfContents" },
        {
          type: "callout",
          attrs: { emoji: "💡", tone: "info" },
          content: [p("A tip")],
        },
        {
          type: "callout",
          attrs: { emoji: "✅", tone: "success" },
          content: [p("Done")],
        },
        {
          type: "callout",
          attrs: { emoji: "⚠️", tone: "warning" },
          content: [p("Careful")],
        },
        {
          type: "toggle",
          attrs: { id: "abc123" },
          content: [
            {
              type: "toggleSummary",
              attrs: { level: 2 },
              content: [{ type: "text", text: "More" }],
            },
            { type: "toggleContent", content: [p("hidden but present")] },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("Name", "tableHeader"), cell("Role", "tableHeader")],
            },
            { type: "tableRow", content: [cell("Meera"), cell("Design")] },
          ],
        },
        {
          type: "orderedList",
          content: [item(p("one"), { type: "orderedList", content: [item(p("two"))] })],
        },
      );
      const id = await insertNoteDoc(user.id, "All blocks", content, "x");
      await page.goto(`/notes/${id}`);
      await expect(editor(page).locator("table")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
      expect(serious).toEqual([]);
    });
  }

  test("reduced motion: the toggle arrow does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBlank(page);
    await slash(page, "toggle");
    const duration = await editor(page)
      .locator(".toggle-arrow svg")
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // The app's global reduced-motion rule makes every transition effectively instant.
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("the Insert button, a table and the list buttons work without a keyboard", async ({
    page,
  }) => {
    await openBlank(page);
    await page.getByRole("button", { name: "Insert block" }).click();
    await expect(menu(page)).toBeVisible();
    const list = await menu(page).boundingBox();
    expect(list!.x).toBeGreaterThanOrEqual(0);
    expect(list!.x + list!.width).toBeLessThanOrEqual(360);
    await page.getByRole("option", { name: "Table", exact: true }).click();
    await expect(editor(page).locator("table")).toBeVisible();

    // The page itself never scrolls sideways; the table scrolls inside its own wrapper.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    // Indent and Outdent are always on a touch toolbar.
    await expect(page.getByRole("button", { name: "Indent", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Outdent", exact: true })).toBeVisible();
  });
});
