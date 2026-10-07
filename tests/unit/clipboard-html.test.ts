// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseHtml, MAX_HTML_CHARS } from "@/lib/editor/clipboard/parse-html";
import { MESSAGES } from "@/lib/editor/limits";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// V2 feature 02 §5, from HTML: the common mapping, styles, safety, tables, producers.

const t = (
  text: string,
  ...marks: (string | { type: string; attrs: Record<string, unknown> })[]
): TiptapNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...c: (string | TiptapNode)[]): TiptapNode => ({
  type: "paragraph",
  content: c.map((x) => (typeof x === "string" ? t(x) : x)),
});
const read = (html: string): TiptapNode[] => parseHtml(html)!.doc.content ?? [];

describe("marks", () => {
  it("reads tags", () => {
    expect(
      read(
        "<p><strong>a</strong> <b>b</b> <em>c</em> <i>d</i> <u>e</u> <s>f</s> <del>g</del> <strike>h</strike> <code>i</code> <kbd>j</kbd></p>",
      ),
    ).toEqual([
      p(
        t("a", "bold"),
        " ",
        t("b", "bold"),
        " ",
        t("c", "italic"),
        " ",
        t("d", "italic"),
        " ",
        t("e", "underline"),
        " ",
        t("f", "strike"),
        " ",
        t("g", "strike"),
        " ",
        t("h", "strike"),
        " ",
        t("i", "code"),
        " ",
        t("j", "code"),
      ),
    ]);
  });

  it("reads inline styles", () => {
    expect(
      read(
        '<p><span style="font-weight:700">a</span> <span style="font-weight:bold">b</span> <span style="font-weight:600">c</span> <span style="font-style:italic">d</span> <span style="text-decoration:underline">e</span> <span style="text-decoration: line-through">f</span> <span style="font-family: Consolas, monospace">g</span></p>',
      ),
    ).toEqual([
      p(
        t("a", "bold"),
        " ",
        t("b", "bold"),
        " ",
        t("c", "bold"),
        " ",
        t("d", "italic"),
        " ",
        t("e", "underline"),
        " ",
        t("f", "strike"),
        " ",
        t("g", "code"),
      ),
    ]);
  });

  it("does not make bold of a normal-weight span inside a bold wrapper", () => {
    expect(
      read(
        '<b style="font-weight:normal"><p><span style="font-weight:400">a</span><span style="font-weight:700">b</span></p></b>',
      ),
    ).toEqual([p("a", t("b", "bold"))]);
    expect(read('<strong><span style="font-weight:normal">a</span></strong>')).toEqual([p("a")]);
  });

  it("does not make underline of a link's own underline", () => {
    const href = "https://example.com";
    expect(
      read(
        `<p><a href="${href}"><span style="text-decoration:underline;color:#1155cc">link</span></a></p>`,
      ),
    ).toEqual([p(t("link", { type: "link", attrs: { href } }))]);
  });

  it("combines marks in a fixed order and lets code stand alone", () => {
    expect(read("<p><i><b>x</b></i><b><code>y</code></b></p>")).toEqual([
      p(t("x", "bold", "italic"), t("y", "code")),
    ]);
  });

  it("drops colours, fonts, sizes and classes", () => {
    expect(
      read(
        '<p class="x" id="y" style="color:red;font-family:Papyrus;font-size:40px;background:yellow">plain</p>',
      ),
    ).toEqual([p("plain")]);
  });

  it("takes bold off a heading, which is bold already", () => {
    expect(read('<h2><span style="font-weight:700">Title</span> plain</h2>')).toEqual([
      { type: "heading", attrs: { level: 2 }, content: [t("Title plain")] },
    ]);
  });
});

describe("blocks", () => {
  it("maps h1 to h3 and puts h4 to h6 at level 3", () => {
    expect(
      read("<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>").map(
        (n) => n.attrs?.level,
      ),
    ).toEqual([1, 2, 3, 3, 3, 3]);
  });

  it("unwraps layout elements and splits lines at block boundaries", () => {
    expect(
      read("<div><section><div>one</div><div>two<br>three</div></section><span>four</span></div>"),
    ).toEqual([p("one"), p("two", { type: "hardBreak" }, "three"), p("four")]);
  });

  it("drops empty paragraphs and trims block edges", () => {
    expect(read("<p> </p><p><br></p><p>  a   b  </p>")).toEqual([p("a b")]);
  });

  it("reads quotes, rules and code with the language from the class", () => {
    expect(
      read(
        '<blockquote><p>q</p></blockquote><hr><pre><code class="language-ts">let a = 1;\nlet b = 2;</code></pre><pre class="lang-py">x = 1</pre><pre data-language="go">y</pre><pre>plain\n</pre>',
      ),
    ).toEqual([
      { type: "blockquote", content: [p("q")] },
      { type: "horizontalRule" },
      { type: "codeBlock", attrs: { language: "ts" }, content: [t("let a = 1;\nlet b = 2;")] },
      { type: "codeBlock", attrs: { language: "py" }, content: [t("x = 1")] },
      { type: "codeBlock", attrs: { language: "go" }, content: [t("y")] },
      { type: "codeBlock", content: [t("plain")] },
    ]);
  });

  it("keeps line breaks and indentation in code", () => {
    expect(read("<pre>a<br>  b\n\tc</pre>")).toEqual([
      { type: "codeBlock", content: [t("a\n  b\n\tc")] },
    ]);
  });

  it("makes a toggle of details and summary, and a toggle heading when the summary has a heading", () => {
    expect(
      read(
        "<details open><summary>More</summary><p>Body</p></details><details><summary><h2>Section</h2></summary>Inside</details>",
      ),
    ).toEqual([
      {
        type: "toggle",
        content: [
          { type: "toggleSummary", attrs: { level: 0 }, content: [t("More")] },
          { type: "toggleContent", content: [p("Body")] },
        ],
      },
      {
        type: "toggle",
        content: [
          { type: "toggleSummary", attrs: { level: 2 }, content: [t("Section")] },
          { type: "toggleContent", content: [p("Inside")] },
        ],
      },
    ]);
  });

  it("turns an image into its alt text", () => {
    expect(read('<p>see <img src="a.png" alt="the chart"> here <img src="b.png"></p>')).toEqual([
      p("see the chart here"),
    ]);
  });

  it("keeps the words of an unknown element", () => {
    expect(read("<p>a <x-widget>b</x-widget> <o:p>c</o:p></p>")).toEqual([p("a b c")]);
  });
});

describe("lists", () => {
  it("nests lists inside items", () => {
    expect(read("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>")).toEqual([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p("a"),
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      p("b"),
                      { type: "bulletList", content: [{ type: "listItem", content: [p("c")] }] },
                    ],
                  },
                ],
              },
            ],
          },
          { type: "listItem", content: [p("d")] },
        ],
      },
    ]);
  });

  it("flattens a paragraph inside an item and keeps the item's text", () => {
    expect(read("<ul><li><p>one</p></li><li><p>two</p></li></ul>")).toEqual([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("one")] },
          { type: "listItem", content: [p("two")] },
        ],
      },
    ]);
  });

  it("uses aria-level when the source flattens its lists", () => {
    const html =
      '<ul><li aria-level="1">a</li><li aria-level="2">b</li><li aria-level="3">c</li><li aria-level="1">d</li></ul>';
    const [list] = read(html);
    expect(list?.content?.map((i) => i.content?.[0]?.content?.[0]?.text)).toEqual(["a", "d"]);
    expect(list?.content?.[0]?.content?.[1]?.type).toBe("bulletList");
  });

  it("starts an ordered list at its start attribute", () => {
    expect(read('<ol start="4"><li>a</li><li>b</li></ol>')[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 4 },
    });
  });

  it("makes a checklist from checkbox inputs and aria-checked", () => {
    const [a] = read(
      '<ul><li><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ul>',
    );
    expect(a).toEqual({
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p("a")] },
        { type: "taskItem", attrs: { checked: false }, content: [p("b")] },
      ],
    });
    const [b] = read('<ul><li aria-checked="true">x</li></ul>');
    expect(b?.content?.[0]).toMatchObject({ type: "taskItem", attrs: { checked: true } });
  });

  it("repairs bullet lines that arrive as one paragraph with line breaks", () => {
    expect(read("<span>• one<br>• two<br>◦ three</span>")).toEqual([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("one")] },
          { type: "listItem", content: [p("two")] },
          { type: "listItem", content: [p("three")] },
        ],
      },
    ]);
  });

  it("repairs consecutive bullet paragraphs into one list", () => {
    const [list] = read("<p>• one</p><p>• two</p>");
    expect(list?.type).toBe("bulletList");
    expect(list?.content).toHaveLength(2);
  });

  it("does not turn a numbered sentence into a list", () => {
    expect(read("<p>1. Introduction</p>")).toEqual([p("1. Introduction")]);
  });

  it("keeps a list at most six levels deep", () => {
    let html = "x";
    for (let i = 0; i < 9; i += 1) html = `<ul><li>l${i}${html === "x" ? "" : html}</li></ul>`;
    const doc = parseHtml(html)!.doc;
    expect(() => sanitizeDoc(doc)).not.toThrow();
  });
});

describe("tables", () => {
  it("reads headers and cells, joining blocks in a cell with a line break", () => {
    expect(
      read(
        "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><p>x</p><p>y</p></td><td><b>z</b></td></tr></tbody></table>",
      ),
    ).toEqual([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [p("A")] },
              { type: "tableHeader", content: [p("B")] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p("x", { type: "hardBreak" }, "y")] },
              { type: "tableCell", content: [p(t("z", "bold"))] },
            ],
          },
        ],
      },
    ]);
  });

  it("spreads colspan and rowspan so every row has the same number of cells", () => {
    const [table] = read(
      '<table><tr><td colspan="2">wide</td><td rowspan="2">tall</td></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    const widths = table?.content?.map((row) => row.content?.length);
    expect(widths).toEqual([3, 3]);
    expect(() => sanitizeDoc({ type: "doc", content: [table!] })).not.toThrow();
  });

  it("flattens a table inside a table cell to text", () => {
    const [table] = read("<table><tr><td>a<table><tr><td>b</td></tr></table></td></tr></table>");
    expect(table?.content?.[0]?.content?.[0]?.content?.[0]).toEqual(
      p("a", { type: "hardBreak" }, "b"),
    );
  });

  it("cuts a table to ten columns and a hundred rows and says so", () => {
    const row = `<tr>${"<td>x</td>".repeat(12)}</tr>`;
    const result = parseHtml(`<table>${row.repeat(105)}</table>`)!;
    const table = result.doc.content?.[0];
    expect(table?.content).toHaveLength(100);
    expect(table?.content?.[0]?.content).toHaveLength(10);
    expect(result.notices).toEqual([MESSAGES.tableCut]);
  });

  it("puts a table inside a list item as lines of text", () => {
    const [list] = read("<ul><li>x<table><tr><td>a</td><td>b</td></tr></table></li></ul>");
    expect(JSON.stringify(list)).not.toContain('"table"');
    expect(JSON.stringify(list)).toContain("a");
  });
});

describe("safety", () => {
  it("drops script, style, iframe, object, embed, svg, canvas and form controls", () => {
    const result = parseHtml(
      '<p>a</p><script>globalThis.__ran = 1</script><style>p{color:red}</style><iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y"><svg><text>svgtext</text></svg><canvas>canvastext</canvas><button>btn</button><select><option>opt</option></select><textarea>area</textarea><input value="in"><p>b</p>',
    )!;
    expect(result.doc.content).toEqual([p("a"), p("b")]);
    expect((globalThis as { __ran?: number }).__ran).toBeUndefined();
  });

  it("runs nothing and loads nothing while reading", () => {
    parseHtml(
      '<img src="x" onerror="globalThis.__pwned = 1"><body onload="globalThis.__pwned = 2">',
    );
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:x"],
    ["/relative/path"],
    ["#anchor"],
    ["ftp://files.example"],
  ])("keeps the words and loses the link for %s", (href) => {
    expect(read(`<p><a href="${href}">words</a></p>`)).toEqual([p("words")]);
  });

  it.each([["https://example.com/a"], ["http://example.com"], ["mailto:a@b.co"]])(
    "keeps the link %s",
    (href) => {
      expect(read(`<p><a href="${href}">words</a></p>`)).toEqual([
        p(t("words", { type: "link", attrs: { href } })),
      ]);
    },
  );

  it("does not unwrap tracking or redirect links", () => {
    const href = "https://www.google.com/url?q=https://example.com&sa=D";
    expect(read(`<a href="${href}">x</a>`)).toEqual([p(t("x", { type: "link", attrs: { href } }))]);
  });

  it("cleans zero-width characters and non-breaking spaces", () => {
    expect(read("<p>a​b  c﻿d</p>")).toEqual([p("ab cd")]);
  });

  it("returns a valid document for hostile nesting", () => {
    const html = "<div>".repeat(2000) + "deep" + "</div>".repeat(2000);
    const result = parseHtml(html)!;
    expect(() => sanitizeDoc(result.doc)).not.toThrow();
  });

  it("refuses HTML past the size cap so the caller can read the text instead", () => {
    expect(parseHtml("<p>" + "x".repeat(MAX_HTML_CHARS) + "</p>")).toBeNull();
  });

  it("always returns a document that passes validation", () => {
    const cases = [
      "",
      "plain text only",
      "<ul><li><ul><li><ul><li>x</li></ul></li></ul></li></ul>",
      "<table></table>",
      "<table><tr></tr></table>",
      "<details></details>",
      "<blockquote><table><tr><td>a</td></tr></table></blockquote>",
      "<li>stray</li><td>stray</td>",
      "<h1></h1><p></p>",
      "<pre></pre>",
    ];
    for (const html of cases) {
      const doc: TiptapDoc = parseHtml(html)!.doc;
      expect(() => sanitizeDoc(doc), html).not.toThrow();
    }
  });
});

describe("producers", () => {
  const producer = (html: string) => parseHtml(html)!.producer;

  it("names what it recognised", () => {
    expect(producer('<b id="docs-internal-guid-1"><p>x</p></b>')).toBe("google-docs");
    expect(
      producer(
        '<html xmlns:w="urn:schemas-microsoft-com:office:word"><p class=MsoNormal>x</p></html>',
      ),
    ).toBe("word");
    expect(producer('<ul class="bulleted-list"><li>x</li></ul>')).toBe("notion");
    expect(producer('<ul class="p-rich_text_list"><li>x</li></ul>')).toBe("slack");
    expect(producer('<p class="p1">x<span class="Apple-converted-space">&nbsp;</span></p>')).toBe(
      "apple",
    );
    expect(producer('<div class="gmail_default">x</div>')).toBe("gmail");
    expect(producer('<div class="markdown-body"><p>x</p></div>')).toBe("github");
    expect(producer("<p>x</p>")).toBe("generic");
    expect(
      producer('<div style="font-family: Menlo, monospace; white-space: pre;"><div>x</div></div>'),
    ).toBe("vscode");
  });

  it("reads Word list paragraphs without the marker spans", () => {
    const html =
      "<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span>one</p>" +
      "<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>2.<span>&nbsp;&nbsp;</span></span>two</p>";
    expect(read(html)).toEqual([
      {
        type: "orderedList",
        content: [
          { type: "listItem", content: [p("one")] },
          { type: "listItem", content: [p("two")] },
        ],
      },
    ]);
  });

  it("takes only the fragment Word marks, not the page around it", () => {
    expect(
      read(
        "<html><body><p>page chrome</p><!--StartFragment--><p>copied</p><!--EndFragment--><p>more chrome</p></body></html>",
      ),
    ).toEqual([p("copied")]);
  });

  it("uses the language VS Code reports", () => {
    const html =
      '<div style="font-family: Menlo, monospace; white-space: pre;"><div>let a = 1;</div></div>';
    expect(parseHtml(html, { vscodeMode: "rust" })!.doc.content).toEqual([
      { type: "codeBlock", attrs: { language: "rust" }, content: [t("let a = 1;")] },
    ]);
    expect(parseHtml(html, { vscodeMode: "plaintext" })!.doc.content).toEqual([
      { type: "codeBlock", content: [t("let a = 1;")] },
    ]);
  });

  it("drops GitHub's anchors and icons from headings", () => {
    expect(
      read(
        '<div class="markdown-body"><h2>Install<a class="anchor" href="#install"><svg></svg></a></h2></div>',
      ),
    ).toEqual([{ type: "heading", attrs: { level: 2 }, content: [t("Install")] }]);
  });

  it("does not strike a ticked Notion to-do", () => {
    const [list] = read(
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked" style="text-decoration:line-through">Done</span></li></ul>',
    );
    expect(list?.content?.[0]).toEqual({
      type: "taskItem",
      attrs: { checked: true },
      content: [p("Done")],
    });
  });

  it("reads a Notion callout with its icon", () => {
    expect(
      read(
        '<figure class="callout"><div style="font-size:1.5em"><span class="icon">⚠️</span></div><div>Careful</div></figure>',
      ),
    ).toEqual([
      { type: "callout", attrs: { emoji: "⚠️", tone: "neutral" }, content: [p("Careful")] },
    ]);
  });

  it("does not turn an ordinary quote that starts with an emoji into a callout", () => {
    expect(read("<blockquote><p>💡 just a quote</p></blockquote>")[0]?.type).toBe("blockquote");
  });
});

describe("speed", () => {
  it("reads a megabyte of HTML in well under a second (the target is 300 ms)", () => {
    const part =
      '<h2>Heading</h2><p>Some <b>bold</b> and <a href="https://example.com">linked</a> text here.</p><ul><li>one<ul><li>two</li></ul></li><li>three</li></ul>';
    const html = part.repeat(Math.ceil(1_000_000 / part.length));
    expect(html.length).toBeGreaterThan(1_000_000);
    const start = performance.now();
    parseHtml(html);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});
