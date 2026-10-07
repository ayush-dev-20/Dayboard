// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseHtml } from "@/lib/editor/clipboard/parse-html";
import { parseText } from "@/lib/editor/clipboard/parse-text";
import { serializeHtml } from "@/lib/editor/clipboard/serialize-html";
import { serializeMarkdown } from "@/lib/editor/clipboard/serialize-markdown";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapNode } from "@/lib/editor/types";

// V2 feature 02 §9: what Dayboard writes, Dayboard reads back (own HTML and own Markdown).

type Mark = string | { type: string; attrs: Record<string, unknown> };
const t = (text: string, ...marks: Mark[]): TiptapNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...c: (string | TiptapNode)[]): TiptapNode => ({
  type: "paragraph",
  content: c.map((x) => (typeof x === "string" ? t(x) : x)),
});
const h = (level: number, text: string): TiptapNode => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const li = (...b: (string | TiptapNode)[]): TiptapNode => ({
  type: "listItem",
  content: b.map((x) => (typeof x === "string" ? p(x) : x)),
});
const ul = (...items: TiptapNode[]): TiptapNode => ({ type: "bulletList", content: items });
const ol = (...items: TiptapNode[]): TiptapNode => ({ type: "orderedList", content: items });
const link = { type: "link", attrs: { href: "https://example.com/a?b=1&c=2" } };
const cell = (type: string, text: string): TiptapNode => ({ type, content: [p(text)] });

const tasks: TiptapNode = {
  type: "taskList",
  content: [
    { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
    { type: "taskItem", attrs: { checked: false }, content: [p("todo ", t("bold", "bold"))] },
  ],
};
const quote: TiptapNode = { type: "blockquote", content: [p("first"), p("second")] };
const code: TiptapNode = {
  type: "codeBlock",
  attrs: { language: "ts" },
  content: [t("const a = 1;\n  if (a < 2) { run(`x`) }")],
};
const rule: TiptapNode = { type: "horizontalRule" };
const table: TiptapNode = {
  type: "table",
  content: [
    { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Role")] },
    { type: "tableRow", content: [cell("tableCell", "Ada"), cell("tableCell", "Engineer")] },
  ],
};
const toggle = (level: number, title: string): TiptapNode => ({
  type: "toggle",
  content: [
    { type: "toggleSummary", attrs: { level }, content: [t(title)] },
    { type: "toggleContent", content: [p("inside")] },
  ],
});
const lists = [
  ul(li("Fruit", ol(li("Apple", ol(li("Red"), li("Green"))), li("Pear"))), li("Veg")),
  {
    type: "orderedList",
    attrs: { start: 3 },
    content: [li("three"), li("four", ul(li("nested")))],
  },
] as TiptapNode[];

const full: TiptapNode[] = [
  h(1, "One"),
  h(2, "Two"),
  h(3, "Three"),
  p(
    "plain ",
    t("bold", "bold"),
    " ",
    t("italic", "italic"),
    " ",
    t("under", "underline"),
    " ",
    t("strike", "strike"),
    " ",
    t("code", "code"),
    " ",
    t("link", link),
    " ",
    t("both", "bold", "italic"),
    " ",
    t("linked bold", link, "bold"),
  ),
  ...lists,
  tasks,
  quote,
  code,
  rule,
  table,
  toggle(0, "More"),
  toggle(2, "Section"),
  p("a", { type: "hardBreak" }, "b"),
];

describe("round trips", () => {
  it("own HTML reads back as the same document, for the whole content set", () => {
    const html = serializeHtml(full);
    const back = parseHtml(html)!;
    expect(back.doc).toEqual({ type: "doc", content: full });
    expect(back.producer).toBe("generic");
  });

  it("own HTML reads back after the tool in the middle has added its own wrapper", () => {
    const html = `<meta charset='utf-8'><div><div>${serializeHtml(full)}</div></div>`;
    expect(parseHtml(html)!.doc.content).toEqual(full);
  });

  it("own Markdown reads back as the same document, for what Markdown can hold", () => {
    const markdownSet: TiptapNode[] = [
      h(1, "One"),
      h(2, "Two"),
      h(3, "Three"),
      p(
        "plain ",
        t("bold", "bold"),
        " ",
        t("italic", "italic"),
        " ",
        t("strike", "strike"),
        " ",
        t("code", "code"),
        " ",
        t("link", link),
        " ",
        t("both", "bold", "italic"),
      ),
      ...lists,
      tasks,
      quote,
      code,
      rule,
      table,
    ];
    const text = serializeMarkdown(markdownSet);
    const back = parseText(text);
    expect(back.kind).toBe("markdown");
    expect(back.doc.content).toEqual(markdownSet);
  });

  it("text with awkward characters survives Markdown", () => {
    const awkward: TiptapNode[] = [
      p("snake_case, *stars*, [brackets], `ticks`, ~~tildes~~, <tags>, back\\slash"),
      p("# not a heading"),
      p("1. not a list"),
      p("- not a bullet"),
      p("> not a quote"),
      ul(li("- item that starts with a dash")),
    ];
    // A paragraph that is only "# x" is escaped, so it needs a Markdown signal to be read as Markdown.
    const text = serializeMarkdown([...awkward, h(1, "marker")]);
    const back = parseText(text);
    expect(back.doc.content?.slice(0, awkward.length)).toEqual(awkward);
  });

  it("everything it reads is a valid document", () => {
    expect(() => sanitizeDoc(parseHtml(serializeHtml(full))!.doc)).not.toThrow();
  });
});
