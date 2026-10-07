import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
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

// V2 feature 02: copy and paste fidelity. Playwright fires paste events with the clipboard data of
// fixtures (what other tools write) and reads what a real copy writes; it cannot drive Slack or
// Notion, so the matrix on real tools is a manual pass (docs/research).

test.use({ viewport: { width: 1280, height: 800 } });

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });

type Doc = { type: "doc"; content?: Node[] };
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};
type Fixture = {
  html: string;
  text: string;
  extras?: Record<string, string>;
  expected: Doc;
};

function fixture(tool: string, name: string): Fixture {
  const file = path.join(
    import.meta.dirname,
    "..",
    "tests",
    "fixtures",
    "clipboard",
    tool,
    `${name}.json`,
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as Fixture;
}

const flavoursOf = (f: Fixture): Record<string, string> => ({
  ...(f.html ? { "text/html": f.html } : {}),
  "text/plain": f.text,
  ...(f.extras ?? {}),
});

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

async function openBlank(page: Page) {
  const { user } = await newUser(page);
  const id = await insertNote(user.id, { title: "Clip", text: "" });
  await page.goto(`/notes/${id}`);
  await editor(page).click();
  return { user, id };
}

/** Fires a paste carrying these clipboard flavours on whatever has focus. */
async function paste(
  page: Page,
  flavours: Record<string, string>,
  options: { plain?: boolean } = {},
) {
  if (options.plain) await page.keyboard.down("Shift");
  await page.evaluate((data) => {
    const target = document.activeElement as HTMLElement;
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    target.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, flavours);
  if (options.plain) await page.keyboard.up("Shift");
}

/** What the next real copy writes, flavour by flavour. */
async function copyFlavours(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => {
    (window as unknown as { __copied: unknown }).__copied = null;
    document.addEventListener(
      "copy",
      (event) => {
        const data = event.clipboardData!;
        (window as unknown as { __copied: unknown }).__copied = Object.fromEntries(
          Array.from(data.types).map((type) => [type, data.getData(type)]),
        );
      },
      { once: true },
    );
  });
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: unknown }).__copied))
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __copied: Record<string, string> }).__copied);
}

/** The saved document with what the editor adds on its own taken out: toggle ids, an empty last paragraph. */
function normalise(doc: Doc | undefined): Doc {
  const content = JSON.parse(JSON.stringify(doc?.content ?? [])) as Node[];
  const strip = (node: Node) => {
    if (node.type === "toggle" && node.attrs) delete node.attrs.id;
    // The editor writes `start: 1` on every numbered list it makes.
    if (node.type === "orderedList" && node.attrs?.start === 1) delete node.attrs.start;
    if (node.attrs && Object.keys(node.attrs).length === 0) delete node.attrs;
    node.content?.forEach(strip);
  };
  content.forEach(strip);
  while (content.length > 1 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content) {
    content.pop();
  }
  return { type: "doc", content };
}

const saved = async (userId: string, title = "Clip") =>
  normalise((await noteByTitle(userId, title))?.content_json as Doc | undefined);

test.describe("copy", () => {
  const mixed = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Some " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Fruit" }] },
              {
                type: "orderedList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Apple" }] }],
                  },
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Pear" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "let a = 1;" }],
      },
    ],
  };

  test("a mixed selection writes three flavours, with clean HTML and Markdown", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(user.id, "Mixed", mixed, "Plan");
    await page.goto(`/notes/${id}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    const copied = await copyFlavours(page);

    expect(Object.keys(copied).sort()).toEqual([
      "application/x-dayboard-slice+json",
      "text/html",
      "text/plain",
    ]);
    const html = copied["text/html"]!;
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain('<ol type="a">');
    expect(html).not.toMatch(/<li><p>/);
    expect(html).not.toMatch(/\s(id|style|data-[\w-]+)=/);
    expect(html).not.toMatch(/class="(?!language-)/);
    expect(html).not.toContain("data-pm-slice");
    expect(copied["text/plain"]).toBe(
      "## Plan\n\nSome **bold** and [link](https://example.com)\n\n- Fruit\n  a. Apple\n  b. Pear\n\n```ts\nlet a = 1;\n```",
    );
  });

  test("a word inside a sentence copies as inline HTML, so pasting it adds no paragraph", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const id = await insertNoteDoc(
      user.id,
      "Inline",
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "one two three" }] }],
      },
      "one two three",
    );
    await page.goto(`/notes/${id}`);
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Alt+ArrowLeft");
    const copied = await copyFlavours(page);
    expect(copied["text/html"]).toBe("three");
    expect(copied["text/plain"]).toBe("three");
  });

  test("cut removes the text and one undo brings it back", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("keep this");
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate(() => {
      document.addEventListener("cut", (e) => e.clipboardData?.setData("text/x-seen", "1"), {
        once: true,
      });
    });
    await page.keyboard.press("ControlOrMeta+x");
    await expect(editor(page)).toHaveText("");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor(page)).toContainText("keep this");
  });
});

test.describe("paste from other tools", () => {
  const cases: [string, string][] = [
    ["google-docs", "rich-text"],
    ["google-docs", "lists"],
    ["google-docs", "table"],
    ["word", "lists"],
    ["word", "table"],
    ["notion", "lists"],
    ["notion", "todo"],
    ["notion", "toggle-callout"],
    ["slack", "bullets-html"],
    ["slack", "bullets-text-only"],
    ["slack", "numbered-text-only"],
    ["slack", "rich-text"],
    ["gmail", "rich-list-quote"],
    ["apple-notes", "list-and-bold"],
    ["web-page", "article"],
    ["github", "readme"],
    ["vscode", "typescript-code"],
  ];

  for (const [tool, name] of cases) {
    test(`${tool} ${name} keeps its structure, and the saved note is valid`, async ({ page }) => {
      const { user } = await openBlank(page);
      const f = fixture(tool, name);
      await paste(page, flavoursOf(f));
      await expect.poll(() => saved(user.id), { timeout: 15_000 }).toEqual(normalise(f.expected));
    });
  }

  test("a list copied from Slack as bullet lines becomes a bulleted list", async ({ page }) => {
    await openBlank(page);
    await paste(page, { "text/plain": "• Fruit\n    ◦ Apple\n    ◦ Pear\n• Veg" });
    await expect(editor(page).locator(":scope > ul > li")).toHaveCount(2);
    await expect(editor(page).locator("ul ul > li")).toHaveCount(2);
    await expect(editor(page).locator("p", { hasText: "•" })).toHaveCount(0);
  });

  test("Cmd/Ctrl+Shift+V pastes the text only, with no detection", async ({ page }) => {
    await openBlank(page);
    await paste(
      page,
      { "text/html": "<h1>Rich</h1>", "text/plain": "# not a heading\n- not a list" },
      { plain: true },
    );
    await expect(editor(page).locator("h1")).toHaveCount(0);
    await expect(editor(page).locator("ul")).toHaveCount(0);
    await expect(editor(page).locator("p").first()).toHaveText("# not a heading");
    await expect(editor(page).locator("p").nth(1)).toHaveText("- not a list");
  });

  test("pasted Markdown text becomes headings, lists and code", async ({ page }) => {
    await openBlank(page);
    await paste(page, {
      "text/plain": "# Plan\n\n1. First\n   a. Inner\n2. Second\n\n```ts\nlet a = 1;\n```",
    });
    await expect(editor(page).locator("h1")).toHaveText("Plan");
    await expect(editor(page).locator("ol ol > li")).toHaveCount(1);
    await expect(editor(page).locator("pre")).toContainText("let a = 1;");
  });

  test("nothing unsafe gets in: no script, no javascript link, no raw markup", async ({ page }) => {
    const { user } = await openBlank(page);
    await paste(page, {
      "text/html":
        '<p>hi <a href="javascript:alert(1)">there</a></p><script>window.__pwned = 1</script><iframe src="https://evil.example"></iframe><img src=x onerror="window.__pwned = 2">',
      "text/plain": "hi there",
    });
    await expect(editor(page)).toContainText("hi there");
    await expect(editor(page).locator("a")).toHaveCount(0);
    await expect(editor(page).locator("script, iframe, img")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Clip"))?.content_text)
      .toContain("hi there");
  });
});

test.describe("where it lands", () => {
  test("several paragraphs pasted into a list item become several items", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("- alpha");
    await paste(page, { "text/plain": "one\n\ntwo\n\nthree" });
    await expect(editor(page).locator("ul > li")).toHaveCount(3);
    await expect(editor(page).locator("ul > li").first()).toContainText("alphaone");
  });

  test("a list pasted at the end of an item nests under it", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("- alpha");
    await paste(page, { "text/html": "<ul><li>x</li><li>y</li></ul>" });
    await expect(editor(page).locator(":scope > ul > li")).toHaveCount(1);
    await expect(editor(page).locator("ul ul > li")).toHaveCount(2);
  });

  test("a code block takes the text, never the structure", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("```ts ");
    await page.keyboard.type("let a;");
    await paste(page, {
      "text/html": "<h1>Big</h1><ul><li>a</li></ul>",
      "text/plain": "x = 1\ny = 2",
    });
    await expect(editor(page).locator("pre")).toContainText("let a;x = 1");
    await expect(editor(page).locator("pre")).toContainText("y = 2");
    await expect(editor(page).locator("h1, ul")).toHaveCount(0);
  });

  test("a table cell takes inline content only", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter");
    await paste(page, { "text/html": "<h2>Head</h2><ul><li>one</li><li>two</li></ul>" });
    await expect(editor(page).locator("table h2, table ul")).toHaveCount(0);
    await expect(editor(page).locator("table th").first()).toContainText("Head");
    await expect(editor(page).locator("table th").first()).toContainText("two");
  });

  test("a note title is one line: pasted lines are joined with spaces", async ({ page }) => {
    await openBlank(page);
    const title = page.getByRole("textbox", { name: "Note title" });
    await title.fill("");
    await title.click();
    await paste(page, { "text/plain": "  First line\nsecond line\r\n\r\nthird  " });
    await expect(title).toHaveValue("First line second line third");
  });

  test("an address pasted over selected text makes it a link", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("read the docs");
    await page.keyboard.press("Shift+Alt+ArrowLeft");
    await paste(page, { "text/plain": "https://example.com/docs" });
    await expect(editor(page).locator('a[href="https://example.com/docs"]')).toHaveText("docs");
    await expect(editor(page)).toContainText("read the docs");
  });

  test("one paste is one undo step", async ({ page }) => {
    await openBlank(page);
    await page.keyboard.type("start");
    await paste(page, { "text/html": "<h1>One</h1><ul><li>a</li><li>b</li></ul><p>end</p>" });
    await expect(editor(page).locator("h1")).toHaveText("One");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor(page).locator("h1")).toHaveCount(0);
    await expect(editor(page)).toHaveText("start");
  });

  test("a paste past the size limit is cut with a message", async ({ page }) => {
    const { user } = await openBlank(page);
    const chunk = "word ".repeat(10_000);
    await paste(page, { "text/html": Array.from({ length: 8 }, () => `<p>${chunk}</p>`).join("") });
    await expect(page.getByText("Pasted content was shortened to fit.")).toBeVisible();
    await expect
      .poll(async () => (await noteByTitle(user.id, "Clip"))?.content_text?.length ?? 0, {
        timeout: 20_000,
      })
      .toBeGreaterThan(50_000);
    expect((await noteByTitle(user.id, "Clip"))!.content_text.length).toBeLessThan(200_000);
  });

  test("a big table is cut to ten columns and a hundred rows with a message", async ({ page }) => {
    await openBlank(page);
    const row = `<tr>${"<td>x</td>".repeat(12)}</tr>`;
    await paste(page, { "text/html": `<table>${row.repeat(105)}</table>` });
    await expect(page.getByText("Table was cut to 10 columns and 100 rows.")).toBeVisible();
    await expect(editor(page).locator("tr")).toHaveCount(100);
    await expect(editor(page).locator("tr").first().locator("td, th")).toHaveCount(10);
  });
});

test.describe("Dayboard to Dayboard", () => {
  const source = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " under", marks: [{ type: "underline" }] },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
          },
        ],
      },
      {
        type: "callout",
        attrs: { emoji: "⚠️", tone: "warning" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "careful" }] }],
      },
      {
        type: "toggle",
        attrs: { id: "abc123" },
        content: [
          {
            type: "toggleSummary",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Section" }],
          },
          {
            type: "toggleContent",
            content: [{ type: "paragraph", content: [{ type: "text", text: "inside" }] }],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
              },
            ],
          },
        ],
      },
    ],
  } satisfies Doc;

  test("a copy pastes into another note and into a task description unchanged", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const from = await insertNoteDoc(user.id, "From", source, "Title");
    const to = await insertNote(user.id, { title: "To", text: "" });
    const taskId = await insertTask(user.id, { title: "Carry over" });

    await page.goto(`/notes/${from}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    const copied = await copyFlavours(page);

    await page.goto(`/notes/${to}`);
    await editor(page).click();
    await paste(page, copied);
    await expect.poll(() => saved(user.id, "To"), { timeout: 15_000 }).toEqual(normalise(source));

    await page.goto(`/tasks?task=${taskId}`);
    const description = detailPanel(page).getByRole("textbox", { name: "Task description" });
    await description.click();
    await paste(page, copied);
    await expect.poll(() => taskDescriptionText(taskId), { timeout: 15_000 }).toContain("inside");
    await expect(description.locator("table")).toHaveCount(1);
    await expect(description.locator(".callout")).toHaveCount(1);
    await expect(description.locator("h1")).toHaveText("Title");
  });
});

test.describe("task descriptions", () => {
  test("a pasted table and a Slack-style list behave as in a note", async ({ page }) => {
    await newUser(page).then(async ({ user }) => {
      const taskId = await insertTask(user.id, { title: "Plan" });
      await page.goto(`/tasks?task=${taskId}`);
      const description = detailPanel(page).getByRole("textbox", { name: "Task description" });
      await description.click();
      await paste(page, flavoursOf(fixture("google-docs", "table")));
      await expect(description.locator("table")).toHaveCount(1);
      // The editor keeps an empty line after a table; the list goes there.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await paste(page, { "text/plain": "• Fruit\n    ◦ Apple\n• Veg" });
      await expect(description.locator(":scope > ul > li")).toHaveCount(2);
      await expect(description.locator("ul ul > li")).toHaveCount(1);
      await expect
        .poll(() => taskDescriptionText(taskId), { timeout: 15_000 })
        .toContain("Engineer");
    });
  });

  test("a task title is one line as well", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Old" });
    await page.goto(`/tasks?task=${taskId}`);
    void user;
    const title = detailPanel(page).getByRole("textbox", { name: "Task title" });
    await expect(title).toHaveValue("Old");
    // Retried as one step: the panel may still be hydrating when the first attempt starts.
    await expect(async () => {
      await title.fill("");
      await paste(page, { "text/plain": "one\ntwo\nthree" });
      await expect(title).toHaveValue("one two three", { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("Copy note and Copy as Markdown", () => {
  const note = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Some " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "First" }] },
              {
                type: "orderedList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Inner" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  async function openNote(page: Page) {
    const { user } = await newUser(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await insertNoteDoc(user.id, "Whole note", note, "Section");
    await page.goto(`/notes/${id}`);
    await expect(editor(page)).toContainText("Section");
    return id;
  }

  const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const clipboardHtml = (page: Page) =>
    page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return item && item.types.includes("text/html")
        ? await (await item.getType("text/html")).text()
        : "";
    });

  test("the note's menu copies the whole note: HTML for rich tools, Markdown text for the rest", async ({
    page,
  }) => {
    await openNote(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Copy note" }).click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
    expect(await clipboardText(page)).toBe(
      "# Whole note\n\n## Section\n\nSome **bold**\n\n1. First\n   a. Inner",
    );
    const html = await clipboardHtml(page);
    expect(html).toContain("<h1>Whole note</h1><h2>Section</h2>");
    expect(html).toContain('<ol type="1"><li>First<ol type="a"><li>Inner</li></ol></li></ol>');
  });

  test("Copy as Markdown writes Markdown text only", async ({ page }) => {
    await openNote(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Copy as Markdown" }).click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
    expect(await clipboardText(page)).toBe(
      "# Whole note\n\n## Section\n\nSome **bold**\n\n1. First\n   a. Inner",
    );
    expect(await clipboardHtml(page)).toBe("");
  });

  test("both are in the command menu for the open note, and not elsewhere", async ({ page }) => {
    await openNote(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("option", { name: "Copy as Markdown" }).click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
    expect(await clipboardText(page)).toContain("## Section");

    await page.goto("/tasks");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByPlaceholder("Search, ask or create")).toBeVisible();
    await expect(page.getByRole("option", { name: "Copy note" })).toHaveCount(0);
  });

  test("what Copy note writes pastes back into Dayboard as the same note", async ({ page }) => {
    const { user } = await newUser(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const from = await insertNoteDoc(user.id, "Source", note, "Section");
    const to = await insertNote(user.id, { title: "Target", text: "" });
    await page.goto(`/notes/${from}`);
    await expect(editor(page)).toContainText("Section");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Copy note" }).click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();

    await page.goto(`/notes/${to}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () => (await saved(user.id, "Target")).content?.map((n) => n.type), {
        timeout: 15_000,
      })
      // The Dayboard flavour carries the body: the title is the note's own field, not its content.
      .toEqual(["heading", "paragraph", "orderedList"]);
  });
});
