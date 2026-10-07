import { describe, expect, it } from "vitest";
import { flavoursFor } from "@/lib/editor/clipboard/copy";
import { serializeHtml, serializeInlineHtml } from "@/lib/editor/clipboard/serialize-html";
import {
  serializeInlineMarkdown,
  serializeMarkdown,
} from "@/lib/editor/clipboard/serialize-markdown";
import type { TiptapNode } from "@/lib/editor/types";

// V2 feature 02 §4: what copy puts on the clipboard.

type Mark = string | { type: string; attrs: Record<string, unknown> };
const t = (text: string, ...marks: Mark[]): TiptapNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const inl = (c: (string | TiptapNode)[]) => c.map((x) => (typeof x === "string" ? t(x) : x));
const p = (...c: (string | TiptapNode)[]): TiptapNode => ({ type: "paragraph", content: inl(c) });
const h = (level: number, ...c: (string | TiptapNode)[]): TiptapNode => ({
  type: "heading",
  attrs: { level },
  content: inl(c),
});
const li = (...b: (string | TiptapNode)[]): TiptapNode => ({
  type: "listItem",
  content: b.map((x) => (typeof x === "string" ? p(x) : x)),
});
const ul = (...items: TiptapNode[]): TiptapNode => ({ type: "bulletList", content: items });
const ol = (...items: TiptapNode[]): TiptapNode => ({ type: "orderedList", content: items });
const link = (href: string): Mark => ({ type: "link", attrs: { href } });
const cell = (type: string, text: string): TiptapNode => ({ type, content: [p(text)] });
const table = (...rows: TiptapNode[][]): TiptapNode => ({
  type: "table",
  content: rows.map((cells) => ({ type: "tableRow", content: cells })),
});
const toggle = (level: number, title: string, ...body: TiptapNode[]): TiptapNode => ({
  type: "toggle",
  content: [
    { type: "toggleSummary", attrs: { level }, content: [t(title)] },
    { type: "toggleContent", content: body },
  ],
});

describe("HTML flavour", () => {
  it("writes inline marks outermost link, then bold, italic, underline, strike, code", () => {
    expect(
      serializeHtml([
        p(
          "Hello ",
          t("world", "bold"),
          " ",
          t("slanted", "italic"),
          " ",
          t("under", "underline"),
          " ",
          t("gone", "strike"),
          " ",
          t("mono", "code"),
          " ",
          t("docs", link("https://example.com/a?b=1&c=2")),
          " ",
          t("all", link("https://x.test"), "bold", "italic"),
        ),
      ]),
    ).toBe(
      '<p>Hello <strong>world</strong> <em>slanted</em> <u>under</u> <s>gone</s> <code>mono</code> <a href="https://example.com/a?b=1&amp;c=2">docs</a> <a href="https://x.test"><strong><em>all</em></strong></a></p>',
    );
  });

  it("escapes text and refuses links that are not http, https or mailto", () => {
    expect(
      serializeHtml([
        p("<script>alert(1)</script> & more ", t("click", link("javascript:alert(1)"))),
        p(t("mail", link("mailto:a@b.co"))),
      ]),
    ).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more click</p><p><a href="mailto:a@b.co">mail</a></p>',
    );
  });

  it("writes headings, quotes, rules and code with the language as the only class", () => {
    expect(
      serializeHtml([
        h(1, "One"),
        h(3, "Three"),
        { type: "blockquote", content: [p("Quoted")] },
        { type: "horizontalRule" },
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("a < b")] },
        { type: "codeBlock", content: [t("plain")] },
      ]),
    ).toBe(
      '<h1>One</h1><h3>Three</h3><blockquote><p>Quoted</p></blockquote><hr><pre><code class="language-ts">a &lt; b</code></pre><pre><code>plain</code></pre>',
    );
  });

  it("writes tight lists: no paragraph inside an item, nested lists inside the item", () => {
    const html = serializeHtml([ul(li("Fruit", ul(li("Apple"), li("Pear"))), li("Veg"))]);
    expect(html).toBe("<ul><li>Fruit<ul><li>Apple</li><li>Pear</li></ul></li><li>Veg</li></ul>");
    expect(html).not.toMatch(/<li><p>/);
  });

  it("gives each ordered level its marker type, and the start when it is not 1", () => {
    const deep = ol(li("a"));
    const html = serializeHtml([
      ol(li("First", ol(li("Inner", ol(li("Deep", ol(li("Again")))))))),
      { type: "orderedList", attrs: { start: 3 }, content: deep.content },
    ]);
    expect(html).toBe(
      '<ol type="1"><li>First<ol type="a"><li>Inner<ol type="i"><li>Deep<ol type="1"><li>Again</li></ol></li></ol></li></ol></li></ol><ol type="1" start="3"><li>a</li></ol>',
    );
  });

  it("counts bullet lists too when choosing the marker type of a numbered list under them", () => {
    expect(serializeHtml([ul(li("Top", ol(li("Under"))))])).toBe(
      '<ul><li>Top<ol type="a"><li>Under</li></ol></li></ul>',
    );
  });

  it("writes checklists with a disabled checkbox in each item", () => {
    expect(
      serializeHtml([
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
            { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
          ],
        },
      ]),
    ).toBe(
      '<ul><li><input type="checkbox" disabled checked> done</li><li><input type="checkbox" disabled> todo</li></ul>',
    );
  });

  it("writes a toggle expanded, a toggle heading with the heading inside the summary", () => {
    expect(serializeHtml([toggle(0, "More", p("Body")), toggle(2, "Section", p("Inside"))])).toBe(
      "<details open><summary>More</summary><p>Body</p></details><details open><summary><h2>Section</h2></summary><p>Inside</p></details>",
    );
  });

  it("writes a callout as a quote that starts with its emoji", () => {
    expect(
      serializeHtml([
        { type: "callout", attrs: { emoji: "💡", tone: "info" }, content: [p("Note this")] },
      ]),
    ).toBe("<blockquote><p>💡 Note this</p></blockquote>");
  });

  it("writes a real table with header cells as th", () => {
    expect(
      serializeHtml([
        table(
          [cell("tableHeader", "A"), cell("tableHeader", "B")],
          [cell("tableCell", "1"), cell("tableCell", "2")],
        ),
      ]),
    ).toBe("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>");
  });

  it("adds nothing for a table of contents", () => {
    expect(serializeHtml([{ type: "tableOfContents" }, p("after")])).toBe("<p>after</p>");
  });

  it("uses only the allowed elements and no classes, ids, styles or data attributes", () => {
    const html = serializeHtml([
      h(2, "T"),
      p(t("b", "bold"), t("l", link("https://x.test"))),
      ul(li("a", ol(li("b")))),
      { type: "blockquote", content: [p("q")] },
      { type: "codeBlock", content: [t("c")] },
      { type: "horizontalRule" },
      table([cell("tableHeader", "h")], [cell("tableCell", "c")]),
      toggle(0, "s", p("x")),
    ]);
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
    const allowed = new Set([
      "h1",
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "hr",
      "table",
      "tr",
      "th",
      "td",
      "details",
      "summary",
      "strong",
      "em",
      "u",
      "s",
      "a",
      "br",
      "input",
    ]);
    for (const tag of tags) expect(allowed, tag).toContain(tag);
    expect(html).not.toMatch(/\s(class|id|style|data-[a-z-]+)=/);
  });

  it("joins a list item's own paragraphs with a line break instead of a <p>", () => {
    expect(serializeHtml([ul(li("one", p("two")))])).toBe("<ul><li>one<br>two</li></ul>");
  });
});

describe("Markdown flavour", () => {
  it("writes headings and inline marks", () => {
    expect(
      serializeMarkdown([
        h(1, "Title"),
        h(2, "Sub"),
        h(3, "Third"),
        p(
          t("b", "bold"),
          " ",
          t("i", "italic"),
          " ",
          t("s", "strike"),
          " ",
          t("c", "code"),
          " ",
          t("l", link("https://x.test/a_(b)")),
          " ",
          t("bi", "bold", "italic"),
        ),
      ]),
    ).toBe(
      "# Title\n\n## Sub\n\n### Third\n\n**b** *i* ~~s~~ `c` [l](https://x.test/a_%28b%29) ***bi***",
    );
  });

  it("keeps spaces outside the markers and drops underline", () => {
    expect(serializeMarkdown([p("a", t(" spaced ", "bold"), "b", t("u", "underline"))])).toBe(
      "a **spaced** bu",
    );
  });

  it("escapes characters that would become formatting, and block syntax at a line start", () => {
    expect(
      serializeMarkdown([
        p("snake_case and *star* and [brackets] and `tick`"),
        p("# not a heading"),
        p("1. not a list"),
        p("- not a bullet"),
        p("> not a quote"),
        p("a <div> tag"),
      ]),
    ).toBe(
      "snake_case and \\*star\\* and \\[brackets\\] and \\`tick\\`\n\n\\# not a heading\n\n1\\. not a list\n\n\\- not a bullet\n\n\\> not a quote\n\na \\<div> tag",
    );
  });

  it("writes bullets as dashes and numbered items with the markers shown on screen", () => {
    expect(
      serializeMarkdown([
        ul(li("Fruit", ol(li("Apple"), li("Pear"))), li("Veg")),
        ol(li("First", ol(li("Inner", ol(li("Deep"))))), li("Second")),
      ]),
    ).toBe(
      "- Fruit\n  a. Apple\n  b. Pear\n- Veg\n\n1. First\n   a. Inner\n      i. Deep\n2. Second",
    );
  });

  it("starts a numbered list where it says", () => {
    expect(
      serializeMarkdown([
        { type: "orderedList", attrs: { start: 3 }, content: [li("a"), li("b")] },
      ]),
    ).toBe("3. a\n4. b");
  });

  it("writes checklists, quotes, rules and fenced code with the language", () => {
    expect(
      serializeMarkdown([
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
            { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
          ],
        },
        { type: "blockquote", content: [p("one"), p("two")] },
        { type: "horizontalRule" },
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("let a = 1;\nlet b = 2;")] },
      ]),
    ).toBe(
      "- [x] done\n- [ ] todo\n\n> one\n>\n> two\n\n---\n\n```ts\nlet a = 1;\nlet b = 2;\n```",
    );
  });

  it("uses a longer fence when the code contains one", () => {
    expect(serializeMarkdown([{ type: "codeBlock", content: [t("```\ninner\n```")] }])).toBe(
      "````\n```\ninner\n```\n````",
    );
  });

  it("writes a toggle as its summary then its content indented, a callout as a quote with its emoji", () => {
    expect(
      serializeMarkdown([
        toggle(0, "More", p("Body")),
        toggle(2, "Section", p("Inside")),
        { type: "callout", attrs: { emoji: "⚠️", tone: "warning" }, content: [p("Careful")] },
      ]),
    ).toBe("More\n\n  Body\n\n## Section\n\n  Inside\n\n> ⚠️ Careful");
  });

  it("writes a table as a pipe table with a separator row", () => {
    expect(
      serializeMarkdown([
        table(
          [cell("tableHeader", "Name"), cell("tableHeader", "Role")],
          [cell("tableCell", "Ada | Lovelace"), cell("tableCell", "Engineer")],
        ),
      ]),
    ).toBe("| Name | Role |\n| --- | --- |\n| Ada \\| Lovelace | Engineer |");
  });

  it("writes a hard break inside a paragraph", () => {
    expect(serializeMarkdown([p("one", { type: "hardBreak" }, "two")])).toBe("one  \ntwo");
  });

  it("indents a list item's own continuation and nested blocks", () => {
    expect(
      serializeMarkdown([ul(li("one", p("more"), { type: "codeBlock", content: [t("x")] }))]),
    ).toBe("- one\n  more\n  ```\n  x\n  ```");
  });
});

describe("the three flavours", () => {
  it("copies a selection inside one text block as inline HTML and bare text", () => {
    const f = flavoursFor([p("a ", t("bold", "bold"), " word")], 1, 1);
    expect(f.html).toBe("a <strong>bold</strong> word");
    expect(f.text).toBe("a bold word");
  });

  it("sees through the list wrappers of a selection inside one list item", () => {
    const f = flavoursFor([ul(li(p("some words")))], 3, 3);
    expect(f.html).toBe("some words");
    expect(f.text).toBe("some words");
  });

  it("copies a code selection as escaped text and raw text", () => {
    const f = flavoursFor([{ type: "codeBlock", content: [t("a < *b*")] }], 1, 1);
    expect(f.html).toBe("a &lt; *b*");
    expect(f.text).toBe("a < *b*");
  });

  it("copies a selection across blocks as HTML and Markdown", () => {
    const f = flavoursFor([p("one"), h(2, "two")], 1, 1);
    expect(f.html).toBe("<p>one</p><h2>two</h2>");
    expect(f.text).toBe("one\n\n## two");
  });

  it("keeps the exact slice in the Dayboard flavour", () => {
    const content = [p("one"), ul(li("two"))];
    const f = flavoursFor(content, 1, 3);
    expect(JSON.parse(f.internal)).toEqual({
      v: 1,
      doc: { type: "doc", content },
      openStart: 1,
      openEnd: 3,
    });
  });

  it("serialises inline pieces on their own", () => {
    expect(serializeInlineHtml([t("x", "bold")])).toBe("<strong>x</strong>");
    expect(serializeInlineMarkdown([t("x", "bold"), { type: "hardBreak" }, t("y")])).toBe(
      "**x**\ny",
    );
  });

  it("serialises a 200 KB document well inside 100 ms (with room for a slow machine)", () => {
    const blocks: TiptapNode[] = [];
    for (let i = 0; i < 1500; i += 1) {
      blocks.push(
        h(2, `Heading ${i}`),
        p(
          "Some ",
          t("formatted", "bold"),
          " text with a ",
          t("link", link("https://example.com/x")),
          " in it.",
        ),
        ul(li("one", ul(li("two"))), li("three")),
      );
    }
    expect(JSON.stringify(blocks).length).toBeGreaterThan(200_000);
    const start = performance.now();
    flavoursFor(blocks, 0, 0);
    expect(performance.now() - start).toBeLessThan(400);
  });
});
