import { describe, expect, it } from "vitest";
import { classifyLine } from "@/lib/editor/clipboard/list-lines";
import { looksLikeMarkdown, parseText, plainParagraphs } from "@/lib/editor/clipboard/parse-text";
import { buildNestedLists } from "@/lib/editor/clipboard/lists";
import { MESSAGES } from "@/lib/editor/limits";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapNode } from "@/lib/editor/types";

// V2 feature 02 §5, plain text: lists from bullets and markers, Markdown detection, paragraphs.

const t = (text: string): TiptapNode => ({ type: "text", text });
const p = (text: string): TiptapNode => ({ type: "paragraph", content: [t(text)] });
const li = (...b: (string | TiptapNode)[]): TiptapNode => ({
  type: "listItem",
  content: b.map((x) => (typeof x === "string" ? p(x) : x)),
});
const ul = (...items: TiptapNode[]): TiptapNode => ({ type: "bulletList", content: items });
const ol = (...items: TiptapNode[]): TiptapNode => ({ type: "orderedList", content: items });

const blocks = (text: string): TiptapNode[] => parseText(text).doc.content ?? [];

describe("list markers in plain text", () => {
  it.each(["•", "◦", "▪", "‣", "·", "–", "—", "-", "*"])("reads %s as a bullet", (glyph) => {
    // `-` and `*` are Markdown too; the answer is the same either way.
    expect(blocks(`${glyph} one\n${glyph} two`)).toEqual([ul(li("one"), li("two"))]);
  });

  it.each(["1.", "1)", "(1)"])("reads %s as a number", (marker) => {
    expect(blocks(`${marker} one\n${marker.replace("1", "2")} two`)).toEqual([
      ol(li("one"), li("two")),
    ]);
  });

  it("reads letters and roman numerals as numbers when they come in a run", () => {
    expect(blocks("a. one\nb. two")).toEqual([ol(li("one"), li("two"))]);
    expect(blocks("i. one\nii. two\niii. three")).toEqual([ol(li("one"), li("two"), li("three"))]);
    expect(blocks("a) one\nb) two")).toEqual([ol(li("one"), li("two"))]);
  });

  it("does not believe a lone letter marker", () => {
    expect(blocks("i. note to self")).toEqual([p("i. note to self")]);
    expect(blocks("I. am here")).toEqual([p("I. am here")]);
  });

  it("believes a lettered marker next to a clearer one", () => {
    expect(blocks("1. First\n   a. Inner")).toEqual([ol(li("First", ol(li("Inner"))))]);
  });

  it("nests by indentation: two spaces, four spaces or a tab", () => {
    for (const pad of ["  ", "    ", "\t"]) {
      expect(blocks(`• one\n${pad}◦ nested\n${pad}${pad}▪ deeper\n• two`)).toEqual([
        ul(li("one", ul(li("nested", ul(li("deeper"))))), li("two")),
      ]);
    }
  });

  it("closes levels when the indentation goes back", () => {
    expect(blocks("• a\n    ◦ b\n        ▪ c\n    ◦ d\n• e")).toEqual([
      ul(li("a", ul(li("b", ul(li("c"))), li("d"))), li("e")),
    ]);
  });

  it("starts a numbered list at its first number", () => {
    expect(blocks("3. three\n4. four")).toEqual([
      { type: "orderedList", attrs: { start: 3 }, content: [li("three"), li("four")] },
    ]);
  });

  it("makes lists of the same kind of item whatever the glyphs were", () => {
    expect(blocks("• one\n    1. inner")).toEqual([ul(li("one", ol(li("inner"))))]);
  });

  it("reads checkbox glyphs as a checklist", () => {
    expect(blocks("☐ todo\n☑ done")).toEqual([
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
          { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
        ],
      },
    ]);
  });

  it("keeps a sentence before a list as its own paragraph", () => {
    expect(blocks("Shopping:\n• milk\n• eggs")).toEqual([
      p("Shopping:"),
      ul(li("milk"), li("eggs")),
    ]);
  });

  it("joins a hanging continuation line to its item", () => {
    expect(blocks("• one that\n   goes on\n• two")).toEqual([
      ul(li("one that goes on"), li("two")),
    ]);
  });

  it("keeps six levels and flattens anything deeper into the sixth", () => {
    const text = Array.from({ length: 9 }, (_, i) => `${"  ".repeat(i)}• level ${i + 1}`).join(
      "\n",
    );
    const doc = parseText(text).doc;
    expect(() => sanitizeDoc(doc)).not.toThrow();
    let depth = 0;
    let node: TiptapNode | undefined = doc.content?.[0];
    while (node) {
      depth += 1;
      node = node.content?.at(-1)?.content?.find((c) => c.type === "bulletList");
    }
    expect(depth).toBe(6);
  });

  it("classifies lines", () => {
    expect(classifyLine("  • x")).toMatchObject({
      kind: "bullet",
      indent: 2,
      glyph: true,
      rest: "x",
    });
    expect(classifyLine("- [x] done")).toMatchObject({ kind: "task", checked: true, rest: "done" });
    expect(classifyLine("12) x")).toMatchObject({ kind: "ordered", start: 12 });
    expect(classifyLine("a. x")).toMatchObject({ kind: "ordered", ambiguous: true });
    expect(classifyLine("plain")).toBeNull();
    expect(classifyLine("**bold** start")).toBeNull();
    expect(classifyLine("-5 degrees")).toBeNull();
    expect(classifyLine("•")).toBeNull();
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and joins single newlines with a space", () => {
    expect(blocks("one\ntwo\n\nthree")).toEqual([p("one two"), p("three")]);
  });

  it("reads CRLF and non-breaking spaces", () => {
    expect(blocks("one\r\ntwo\r\n\r\nthree four")).toEqual([p("one two"), p("three four")]);
  });

  it("gives nothing for empty text", () => {
    expect(blocks("  \n \n")).toEqual([]);
  });

  it("makes one paragraph per line for a plain paste", () => {
    expect(plainParagraphs("# one\n\n- two\n**three**")).toEqual([
      p("# one"),
      p("- two"),
      p("**three**"),
    ]);
  });
});

describe("Markdown detection", () => {
  it.each([
    ["a heading", "# Title\ntext"],
    ["a fence", "```\ncode\n```"],
    ["a list", "- one\n- two"],
    ["a numbered list", "1. one\n2. two"],
    ["a quote", "> said"],
    ["a table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
    ["two weak signs", "some **bold** and a [link](https://x.test)"],
    ["bold and code", "use **this** with `code`"],
  ])("is Markdown: %s", (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ["a stray star", "Use the * wildcard here"],
    ["a hash in prose", "see #5 for details"],
    ["one bold word", "this is **important** indeed"],
    ["one link", "read [this](https://x.test)"],
    ["one code word", "run `make` now"],
    ["a pound sign", "costs #5 each, #6 more"],
    ["a dash in prose", "well - maybe"],
    ["plain lines", "one\ntwo"],
  ])("is not Markdown: %s", (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe("Markdown pastes", () => {
  it("uses the converter for headings, marks, code and tables", () => {
    const result = parseText(
      "# Title\n\nSome **bold** and `code`.\n\n```ts\nlet a = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
    expect(result.kind).toBe("markdown");
    expect(result.doc.content?.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "codeBlock",
      "table",
    ]);
    expect(result.doc.content?.[2]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [t("let a = 1;")],
    });
  });

  it("keeps six list levels, not the three AI text keeps", () => {
    const text = Array.from({ length: 6 }, (_, i) => `${"  ".repeat(i)}- level ${i + 1}`).join(
      "\n",
    );
    let depth = 0;
    let node: TiptapNode | undefined = parseText(text).doc.content?.[0];
    while (node) {
      depth += 1;
      node = node.content?.at(-1)?.content?.find((c) => c.type === "bulletList");
    }
    expect(depth).toBe(6);
  });

  it("reads the markers Dayboard writes on copy (1. a. i.) back as lists", () => {
    expect(blocks("1. First\n   a. Inner\n      i. Deep\n2. Second\n\nand text")).toEqual([
      ol(li("First", ol(li("Inner", ol(li("Deep"))))), li("Second")),
      p("and text"),
    ]);
  });

  it("leaves list-looking lines inside a code fence alone", () => {
    const doc = parseText("# x\n\n```\n• not a list\na. nor this\n```").doc;
    expect(doc.content?.[1]).toEqual({
      type: "codeBlock",
      content: [t("• not a list\na. nor this")],
    });
  });

  it("reads bullet glyphs inside Markdown too", () => {
    expect(blocks("# Plan\n\n• one\n• two")).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [t("Plan")] },
      ul(li("one"), li("two")),
    ]);
  });

  it("cuts a table past the limits and says so", () => {
    const wide = `| ${Array.from({ length: 12 }, (_, i) => `c${i}`).join(" | ")} |`;
    const rule = `| ${Array.from({ length: 12 }, () => "---").join(" | ")} |`;
    const result = parseText([wide, rule, wide].join("\n"));
    expect(result.notices).toEqual([MESSAGES.tableCut]);
    expect(result.doc.content?.[0]?.content?.[0]?.content).toHaveLength(10);
  });

  it("reads a checklist", () => {
    expect(blocks("- [x] done\n- [ ] todo")[0]).toMatchObject({ type: "taskList" });
  });
});

describe("nested list builder", () => {
  const item = (depth: number, text: string, kind: "bullet" | "ordered" | "task" = "bullet") => ({
    depth,
    kind,
    content: [p(text)],
  });

  it("closes a gap in levels", () => {
    expect(buildNestedLists([item(0, "a"), item(3, "b")])).toEqual([ul(li("a", ul(li("b"))))]);
  });

  it("starts from the shallowest level when the first item is deep", () => {
    expect(buildNestedLists([item(2, "a"), item(3, "b"), item(2, "c")])).toEqual([
      ul(li("a", ul(li("b"))), li("c")),
    ]);
  });

  it("starts a sibling list when the kind changes at the same level", () => {
    expect(buildNestedLists([item(0, "a"), item(0, "b", "ordered")])).toEqual([
      ul(li("a")),
      ol(li("b")),
    ]);
  });

  it("nests a numbered list under a bullet", () => {
    expect(buildNestedLists([item(0, "a"), item(1, "b", "ordered")])).toEqual([
      ul(li("a", ol(li("b")))),
    ]);
  });

  it("keeps a checklist item's children at its own level (checklists cannot hold lists)", () => {
    const [list] = buildNestedLists([item(0, "a", "task"), item(1, "b", "task")]);
    expect(list?.type).toBe("taskList");
    expect(list?.content).toHaveLength(2);
  });

  it("gives a list item without content an empty paragraph", () => {
    expect(buildNestedLists([{ depth: 0, kind: "bullet", content: [] }])).toEqual([
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    ]);
  });

  it("turns a pasted table inside an item into lines of text", () => {
    const table: TiptapNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("a")] },
            { type: "tableCell", content: [p("b")] },
          ],
        },
      ],
    };
    const [list] = buildNestedLists([{ depth: 0, kind: "bullet", content: [p("x"), table] }]);
    expect(list).toEqual(ul(li("x", p("a | b"))));
  });
});
