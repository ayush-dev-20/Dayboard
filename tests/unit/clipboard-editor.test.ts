// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardFidelity } from "@/components/editor/clipboard-extension";
import { createExtensions } from "@/components/editor/extensions";
import { INTERNAL_MIME } from "@/lib/editor/clipboard/slice";
import { MESSAGES } from "@/lib/editor/limits";
import { MAX_DOC_BYTES, sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// V2 feature 02 against a real ProseMirror editor: copy and paste events carrying fixture-like
// clipboard data, and where the content lands.

const t = (text: string, ...marks: string[]): TiptapNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}),
});
const p = (...c: (string | TiptapNode)[]): TiptapNode => ({
  type: "paragraph",
  content: c.map((x) => (typeof x === "string" ? t(x) : x)),
});
const li = (...b: (string | TiptapNode)[]): TiptapNode => ({
  type: "listItem",
  content: b.map((x) => (typeof x === "string" ? p(x) : x)),
});
const ul = (...items: TiptapNode[]): TiptapNode => ({ type: "bulletList", content: items });
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });

const notices: string[] = [];
const editors: Editor[] = [];

function makeEditor(content: TiptapDoc): Editor {
  const editor = new Editor({
    extensions: [
      ...createExtensions("", { interactive: false }),
      ClipboardFidelity.configure({
        getContext: () => ({ surface: "note", ownerId: null, offline: false }),
        onNotice: (message) => notices.push(message),
      }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  notices.length = 0;
});

type Flavours = Record<string, string>;
function transfer(initial: Flavours = {}) {
  const data = { ...initial };
  return {
    data,
    get types() {
      return Object.keys(data);
    },
    files: [] as File[],
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    clearData: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
  };
}

function fire(editor: Editor, type: "paste" | "copy" | "cut", data: ReturnType<typeof transfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  editor.view.dom.dispatchEvent(event);
  return event;
}

const paste = (editor: Editor, flavours: Flavours) => fire(editor, "paste", transfer(flavours));
// The editor keeps an empty paragraph after a last list or table (Tiptap's trailing node); it is not
// part of what these tests are about.
function withoutTrailing(d: TiptapDoc): TiptapDoc {
  const content = [...(d.content ?? [])];
  while (content.length > 1 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content) {
    content.pop();
  }
  return { ...d, content };
}
const json = (editor: Editor) => withoutTrailing(editor.getJSON() as TiptapDoc);

function copyAll(editor: Editor) {
  editor.commands.selectAll();
  const data = transfer();
  fire(editor, "copy", data);
  return data.data;
}

describe("copy", () => {
  const full = doc(
    { type: "heading", attrs: { level: 2 }, content: [t("Title")] },
    p("some ", t("bold", "bold"), " text"),
    ul(li("Fruit", { type: "orderedList", content: [li("Apple"), li("Pear")] }), li("Veg")),
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
            { type: "tableCell", content: [p("1")] },
            { type: "tableCell", content: [p("2")] },
          ],
        },
      ],
    },
  );

  it("writes the three flavours, clean", () => {
    const editor = makeEditor(full);
    const out = copyAll(editor);
    expect(Object.keys(out).sort()).toEqual([
      "application/x-dayboard-slice+json",
      "text/html",
      "text/plain",
    ]);
    expect(out["text/html"]).toBe(
      '<h2>Title</h2><p>some <strong>bold</strong> text</p><ul><li>Fruit<ol type="a"><li>Apple</li><li>Pear</li></ol></li><li>Veg</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(out["text/html"]).not.toMatch(/<li><p>|\sclass=|\sstyle=|data-pm/);
    expect(out["text/plain"]).toBe(
      "## Title\n\nsome **bold** text\n\n- Fruit\n  a. Apple\n  b. Pear\n- Veg\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("copies a word inside a paragraph as inline HTML", () => {
    const editor = makeEditor(doc(p("one two ", t("three", "bold"), " four")));
    editor.commands.setTextSelection({ from: 9, to: 14 });
    const data = transfer();
    fire(editor, "copy", data);
    expect(data.data["text/html"]).toBe("<strong>three</strong>");
    expect(data.data["text/plain"]).toBe("three");
  });

  it("copies nothing for an empty selection and leaves the default alone", () => {
    const editor = makeEditor(doc(p("x")));
    editor.commands.setTextSelection(1);
    const data = transfer();
    const event = fire(editor, "copy", data);
    expect(data.data).toEqual({});
    expect(event.defaultPrevented).toBe(false);
  });

  it("cut removes the selection, writes the same flavours, and one undo restores it", () => {
    const editor = makeEditor(doc(p("keep "), p("cut me")));
    editor.commands.setTextSelection({ from: 8, to: 14 });
    const before = json(editor);
    const data = transfer();
    fire(editor, "cut", data);
    expect(data.data["text/plain"]).toBe("cut me");
    expect(json(editor)).not.toEqual(before);
    editor.commands.undo();
    expect(json(editor)).toEqual(before);
  });
});

describe("Dayboard to Dayboard", () => {
  it("is lossless, for every kind of block", () => {
    const source = doc(
      { type: "heading", attrs: { level: 1 }, content: [t("H")] },
      p(t("b", "bold"), t(" i", "italic"), t(" l", "underline")),
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p("done")] }],
      },
      { type: "blockquote", content: [p("q")] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [t("a < b")] },
      { type: "horizontalRule" },
      { type: "callout", attrs: { emoji: "⚠️", tone: "warning" }, content: [p("careful")] },
      {
        type: "toggle",
        attrs: { id: "abc123" },
        content: [
          { type: "toggleSummary", attrs: { level: 2 }, content: [t("Section")] },
          { type: "toggleContent", content: [p("inside")] },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", attrs: { colwidth: [150] }, content: [p("h")] }],
          },
          {
            type: "tableRow",
            content: [{ type: "tableCell", attrs: { colwidth: [150] }, content: [p("c")] }],
          },
        ],
      },
      ul(li("one", ul(li("two")))),
    );
    const a = makeEditor(source);
    const copied = copyAll(a);
    const b = makeEditor(doc(p()));
    paste(b, copied);
    const result = json(b);
    // The toggle gets a fresh id in the new place; everything else is the same.
    const strip = (d: TiptapDoc) =>
      JSON.parse(JSON.stringify(d).replace(/"id":"[a-z0-9]+",?/g, "")) as TiptapDoc;
    // Compared with the source as the editor holds it (it adds defaults such as colspan).
    expect(strip(result)).toEqual(strip(json(a)));
    expect(() => sanitizeDoc(result)).not.toThrow();
    expect(result.content?.find((n) => n.type === "toggle")?.attrs?.id).toMatch(/^[a-z0-9]{4,16}$/);
  });

  it("falls back to the HTML flavour when the Dayboard one is missing or unknown", () => {
    const a = makeEditor(doc(p("one"), ul(li("two"), li("three"))));
    const copied = copyAll(a);
    for (const drop of [
      { ...copied, [INTERNAL_MIME]: "" },
      { ...copied, [INTERNAL_MIME]: JSON.stringify({ v: 99 }) },
    ]) {
      const b = makeEditor(doc(p()));
      paste(b, drop);
      expect(json(b).content?.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    }
  });

  it("refuses a Dayboard flavour carrying a javascript: link and uses the HTML instead", () => {
    const evil = JSON.stringify({
      v: 1,
      openStart: 1,
      openEnd: 1,
      doc: {
        type: "doc",
        content: [
          p({
            type: "text",
            text: "x",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          }),
        ],
      },
    });
    const b = makeEditor(doc(p()));
    paste(b, {
      [INTERNAL_MIME]: evil,
      "text/html": "<p>safe words</p>",
      "text/plain": "safe words",
    });
    expect(JSON.stringify(json(b))).not.toContain("javascript");
    expect(JSON.stringify(json(b))).toContain("safe words");
  });
});

describe("paste from other tools", () => {
  it("turns bullet lines (a Slack list that arrived as text) into a bulleted list", () => {
    const editor = makeEditor(doc(p()));
    const event = paste(editor, { "text/plain": "• one\n    ◦ nested\n• two" });
    expect(event.defaultPrevented).toBe(true);
    expect(json(editor)).toEqual(doc(ul(li("one", ul(li("nested"))), li("two"))));
  });

  it("reads HTML in preference to the text beside it", () => {
    const editor = makeEditor(doc(p()));
    paste(editor, {
      "text/html": "<h2>Head</h2><p>and <b>bold</b></p>",
      "text/plain": "Head\nand bold",
    });
    expect(json(editor)).toEqual(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Head")] },
        p("and ", t("bold", "bold")),
      ),
    );
  });

  it("reads Markdown text with the converter", () => {
    const editor = makeEditor(doc(p()));
    paste(editor, { "text/plain": "# Plan\n\n- [x] done\n- [ ] todo" });
    expect(json(editor).content?.map((n) => n.type)).toEqual(["heading", "taskList"]);
  });

  it("leaves a paste of nothing readable to the browser", () => {
    const editor = makeEditor(doc(p("x")));
    const event = paste(editor, {});
    expect(event.defaultPrevented).toBe(false);
    expect(json(editor)).toEqual(doc(p("x")));
  });

  it("leaves a paste of files alone (images are feature 09)", () => {
    const editor = makeEditor(doc(p("x")));
    const data = transfer();
    data.files = [new File(["x"], "a.png", { type: "image/png" })];
    const event = fire(editor, "paste", data);
    expect(event.defaultPrevented).toBe(false);
  });

  it("is one undo step", () => {
    const editor = makeEditor(doc(p("start")));
    editor.commands.focus("end");
    const before = json(editor);
    paste(editor, { "text/html": "<h1>One</h1><ul><li>a</li><li>b</li></ul><p>end</p>" });
    expect(json(editor)).not.toEqual(before);
    editor.commands.undo();
    expect(json(editor)).toEqual(before);
  });

  it("does not apply the editor's own paste rules (no auto-links, no marks from text)", () => {
    const editor = makeEditor(doc(p()));
    paste(editor, { "text/plain": "visit https://example.com now and **not bold**" });
    expect(JSON.stringify(json(editor))).not.toContain("marks");
  });
});

describe("plain paste", () => {
  it("pastes the text only, one paragraph per line, with no detection", () => {
    const editor = makeEditor(doc(p()));
    (editor.view as unknown as { input: { shiftKey: boolean } }).input.shiftKey = true;
    paste(editor, {
      "text/html": "<h1>Rich</h1>",
      "text/plain": "# not a heading\n\n- not a list\n**not bold**",
    });
    expect(json(editor)).toEqual(doc(p("# not a heading"), p("- not a list"), p("**not bold**")));
  });
});

describe("where the content lands", () => {
  it("adds one pasted word to the sentence without a paragraph break", () => {
    const editor = makeEditor(doc(p("hello world")));
    editor.commands.setTextSelection(7);
    paste(editor, { "text/html": "<span>big </span>", "text/plain": "big " });
    expect(json(editor)).toEqual(doc(p("hello big world")));
  });

  it("splits a paragraph only for pasted blocks", () => {
    const editor = makeEditor(doc(p("hello world")));
    editor.commands.setTextSelection(7);
    paste(editor, { "text/plain": "one\n\ntwo" });
    expect(json(editor)).toEqual(doc(p("hello one"), p("twoworld")));
  });

  it("makes several pasted paragraphs several items inside a list item", () => {
    const editor = makeEditor(doc(ul(li("alpha"))));
    editor.commands.setTextSelection(8);
    paste(editor, { "text/plain": "one\n\ntwo\n\nthree" });
    expect(json(editor)).toEqual(doc(ul(li("alphaone"), li("two"), li("three"))));
  });

  it("nests a pasted list under the item it is pasted at the end of", () => {
    const editor = makeEditor(doc(ul(li("alpha"))));
    editor.commands.setTextSelection(8);
    paste(editor, { "text/html": "<ul><li>x</li><li>y</li></ul>" });
    expect(json(editor)).toEqual(doc(ul(li("alpha", ul(li("x"), li("y"))))));
  });

  it("pastes only the text inside a code block", () => {
    const editor = makeEditor(doc({ type: "codeBlock", content: [t("let a;")] }));
    editor.commands.setTextSelection(7);
    paste(editor, { "text/html": "<h1>Big</h1><ul><li>a</li></ul>", "text/plain": "x = 1\ny = 2" });
    const [code, ...rest] = json(editor).content!;
    expect(rest).toEqual([]);
    expect(code?.type).toBe("codeBlock");
    expect(code?.content).toEqual([t("let a;x = 1\ny = 2")]);
  });

  it("pastes inline content only into a table cell, joining blocks with a line break", () => {
    const cell = (type: string, text: string): TiptapNode => ({ type, content: [p(text)] });
    const editor = makeEditor(
      doc({
        type: "table",
        content: [{ type: "tableRow", content: [cell("tableCell", "a"), cell("tableCell", "b")] }],
      }),
    );
    editor.commands.setTextSelection(5);
    paste(editor, { "text/html": "<h2>Head</h2><ul><li>one</li><li>two</li></ul>" });
    const table = json(editor).content?.[0];
    expect(table?.type).toBe("table");
    expect(JSON.stringify(table)).not.toContain("heading");
    expect(JSON.stringify(table)).not.toContain("bulletList");
    expect(
      table?.content?.[0]?.content?.[0]?.content?.[0]?.content?.map((n) => n.text ?? "\n").join(""),
    ).toBe("aHead\none\ntwo");
  });

  it("makes a pasted address over selected text a link and changes nothing else", () => {
    const editor = makeEditor(doc(p("read the docs here")));
    editor.commands.setTextSelection({ from: 10, to: 14 });
    paste(editor, { "text/plain": "https://example.com/docs" });
    const [paragraph] = json(editor).content!;
    expect(paragraph?.content?.map((n) => n.text)).toEqual(["read the ", "docs", " here"]);
    expect(paragraph?.content?.[1]?.marks).toHaveLength(1);
    expect(paragraph?.content?.[1]?.marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://example.com/docs" },
    });
    expect(paragraph?.content?.[0]?.marks).toBeUndefined();
  });

  it("pastes an address as text when nothing is selected", () => {
    const editor = makeEditor(doc(p("see ")));
    editor.commands.focus("end");
    paste(editor, { "text/plain": "https://example.com/docs" });
    expect(json(editor)).toEqual(doc(p("see https://example.com/docs")));
  });

  it("flattens a pasted table into text where a table cannot go (inside a list item)", () => {
    const editor = makeEditor(doc(ul(li("x"))));
    editor.commands.setTextSelection(3);
    paste(editor, { "text/html": "<table><tr><td>a</td><td>b</td></tr></table>" });
    expect(JSON.stringify(json(editor))).not.toContain('"table"');
    expect(JSON.stringify(json(editor))).toContain("a | b");
  });
});

describe("limits", () => {
  it("cuts a paste that would pass the document size and says so", () => {
    const editor = makeEditor(doc(p("start")));
    editor.commands.focus("end");
    const chunk = "word ".repeat(10_000);
    const html = Array.from({ length: 8 }, () => `<p>${chunk}</p>`).join("");
    paste(editor, { "text/html": html });
    const size = new TextEncoder().encode(JSON.stringify(json(editor))).length;
    expect(size).toBeLessThan(MAX_DOC_BYTES);
    expect(notices).toContain(MESSAGES.pasteShortened);
    expect(json(editor).content!.length).toBeGreaterThan(1);
  });

  it("cuts a table to ten columns and a hundred rows and says so", () => {
    const editor = makeEditor(doc(p()));
    const row = `<tr>${"<td>x</td>".repeat(12)}</tr>`;
    paste(editor, { "text/html": `<table>${row.repeat(105)}</table>` });
    const table = json(editor).content?.find((n) => n.type === "table");
    expect(table?.content).toHaveLength(100);
    expect(table?.content?.[0]?.content).toHaveLength(10);
    expect(notices).toContain(MESSAGES.tableCut);
  });

  it("keeps the words when a list would go deeper than the editor allows", () => {
    let nested = ul(li("deepest"));
    for (let i = 0; i < 5; i += 1) nested = ul(li(`l${i}`, nested));
    const editor = makeEditor(doc(nested));
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    const warn = vi.fn();
    void warn;
    paste(editor, { "text/html": "<ul><li>extra<ul><li>more</li></ul></li></ul>" });
    expect(JSON.stringify(json(editor))).toContain("extra");
  });
});
