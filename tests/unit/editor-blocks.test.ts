import { describe, expect, it } from "vitest";
import { LIST_MAX_DEPTH, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "@/lib/editor/limits";
import { alphaLabel, levelOf, markerFor, romanLabel } from "@/lib/editor/list-markers";
import { isEmptyDoc, toPlainText } from "@/lib/editor/projection";
import { EditorDocError, MAX_DEPTH, sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";

const text = (value: string, marks?: { type: string }[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const cell = (value: string, type: "tableCell" | "tableHeader" = "tableCell") => ({
  type,
  content: [p(text(value))],
});
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });
const table = (...rows: unknown[]) => ({ type: "table", content: rows });
const toggle = (summary: string, ...content: unknown[]) => ({
  type: "toggle",
  attrs: { id: "abc123" },
  content: [
    { type: "toggleSummary", attrs: { level: 0 }, content: [text(summary)] },
    { type: "toggleContent", content },
  ],
});
const callout = (...content: unknown[]) => ({
  type: "callout",
  attrs: { emoji: "💡", tone: "neutral" },
  content,
});
const list = (type: "bulletList" | "orderedList", ...items: unknown[]) => ({
  type,
  content: items.map((content) => ({ type: "listItem", content: content as unknown[] })),
});

describe("markers by depth", () => {
  it("cycles numbers, letters and roman numerals; bullets dot, circle, square", () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => markerFor("ordered", d, 1))).toEqual([
      "1.",
      "a.",
      "i.",
      "1.",
      "a.",
      "i.",
    ]);
    expect([1, 2, 3, 4].map((d) => markerFor("bullet", d, 1))).toEqual(["•", "◦", "▪", "•"]);
    expect(levelOf(7)).toBe(levelOf(LIST_MAX_DEPTH));
  });

  it("continues letters after z", () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(alphaLabel)).toEqual([
      "a",
      "b",
      "z",
      "aa",
      "ab",
      "az",
      "ba",
    ]);
    expect(markerFor("ordered", 2, 28)).toBe("ab.");
  });

  it("writes roman numerals", () => {
    expect([1, 2, 3, 4, 5, 9, 10, 14, 19, 39].map(romanLabel)).toEqual([
      "i",
      "ii",
      "iii",
      "iv",
      "v",
      "ix",
      "x",
      "xiv",
      "xix",
      "xxxix",
    ]);
    expect(markerFor("ordered", 3, 4)).toBe("iv.");
    expect(romanLabel(5000)).toBe("5000");
  });

  it("starts numbers where the list says", () => {
    expect(markerFor("ordered", 1, 7)).toBe("7.");
  });
});

describe("sanitizeDoc: the new blocks", () => {
  it("accepts every new node and returns it unchanged", () => {
    const input = doc(
      callout(p(text("Heads up")), list("bulletList", [p(text("a"))])),
      toggle("More", p(text("hidden")), table(row(cell("h", "tableHeader")), row(cell("x")))),
      { type: "tableOfContents" },
      table(
        row(cell("Name", "tableHeader"), cell("Role", "tableHeader")),
        row(cell("Meera"), cell("Design")),
      ),
    );
    expect(sanitizeDoc(input)).toEqual(input);
  });

  it("fills in callout and summary defaults and keeps a column width", () => {
    const out = sanitizeDoc(
      doc(
        { type: "callout", content: [p(text("x"))] },
        table(
          row({
            type: "tableCell",
            attrs: { colwidth: [160], colspan: 3, rowspan: 2 },
            content: [p(text("x"))],
          }),
        ),
        {
          type: "toggle",
          content: [{ type: "toggleSummary", content: [text("s")] }, { type: "toggleContent" }],
        },
      ),
    ) as TiptapDoc;
    expect(out.content![0]!.attrs).toEqual({ emoji: "💡", tone: "neutral" });
    expect(out.content![1]!.content![0]!.content![0]!.attrs).toEqual({ colwidth: [160] });
    expect(out.content![2]!.content![0]!.attrs).toEqual({ level: 0 });
  });

  it("drops a toggle id that is not a short token", () => {
    const out = sanitizeDoc(
      doc({
        type: "toggle",
        attrs: { id: "<script>" },
        content: [{ type: "toggleSummary", content: [] }, { type: "toggleContent" }],
      }),
    ) as TiptapDoc;
    expect(out.content![0]!.attrs).toBeUndefined();
  });

  it.each([
    [
      "a callout tone that doesn't exist",
      doc({ type: "callout", attrs: { tone: "danger" }, content: [p(text("x"))] }),
    ],
    [
      "a callout emoji that is text",
      doc({ type: "callout", attrs: { emoji: "hi" }, content: [p(text("x"))] }),
    ],
    ["an empty callout", doc({ type: "callout", content: [] })],
    [
      "a toggle heading level 4",
      doc({
        type: "toggle",
        content: [
          { type: "toggleSummary", attrs: { level: 4 }, content: [] },
          { type: "toggleContent" },
        ],
      }),
    ],
    [
      "a toggle without a content part",
      doc({ type: "toggle", content: [{ type: "toggleSummary", content: [] }] }),
    ],
    ["a table inside a callout", doc(callout(table(row(cell("x")))))],
    ["a callout inside a callout", doc(callout(callout(p(text("x")))))],
    [
      "a table inside a table cell",
      doc(table(row({ type: "tableCell", content: [table(row(cell("x")))] }))),
    ],
    ["a table inside a list item", doc(list("bulletList", [table(row(cell("x")))]))],
    ["a table inside a quote", doc({ type: "blockquote", content: [table(row(cell("x")))] })],
    ["a row with no cells", doc(table({ type: "tableRow", content: [] }))],
    ["a table with uneven rows", doc(table(row(cell("a"), cell("b")), row(cell("c"))))],
    ["a table cell outside a row", doc({ type: "tableCell", content: [p(text("x"))] })],
    ["a toggle summary outside a toggle", doc({ type: "toggleSummary", content: [] })],
    [
      "a heading inside a table cell",
      doc(
        table(
          row({
            type: "tableCell",
            content: [{ type: "heading", attrs: { level: 1 }, content: [text("x")] }],
          }),
        ),
      ),
    ],
  ])("rejects %s", (_name, input) => {
    expect(() => sanitizeDoc(input)).toThrow(EditorDocError);
  });

  it("enforces the table limits", () => {
    const wide = (n: number) =>
      doc(table(row(...Array.from({ length: n }, (_, i) => cell(String(i))))));
    expect(() => sanitizeDoc(wide(TABLE_MAX_COLUMNS))).not.toThrow();
    expect(() => sanitizeDoc(wide(TABLE_MAX_COLUMNS + 1))).toThrow(/10 columns/);

    const tall = (n: number) =>
      doc(table(...Array.from({ length: n }, (_, i) => row(cell(String(i))))));
    expect(() => sanitizeDoc(tall(TABLE_MAX_ROWS))).not.toThrow();
    expect(() => sanitizeDoc(tall(TABLE_MAX_ROWS + 1))).toThrow(/100 rows/);
  });

  it("allows six list levels and refuses a seventh", () => {
    const levels = (n: number): unknown => {
      let inner: unknown = [p(text("x"))];
      for (let i = 1; i < n; i += 1) inner = [p(text("x")), list("bulletList", inner)];
      return list("bulletList", inner);
    };
    expect(() => sanitizeDoc(doc(levels(LIST_MAX_DEPTH)))).not.toThrow();
    expect(() => sanitizeDoc(doc(levels(LIST_MAX_DEPTH + 1)))).toThrow(/six levels/);
  });

  it("allows the deepest sensible document and still refuses an absurd one", () => {
    expect(MAX_DEPTH).toBe(32);
    // Six list levels inside a toggle inside a toggle.
    let inner: unknown = [p(text("x"))];
    for (let i = 1; i < LIST_MAX_DEPTH; i += 1) inner = [p(text("x")), list("orderedList", inner)];
    const deep = toggle("outer", toggle("inner", list("orderedList", inner)));
    expect(() => sanitizeDoc(doc(deep))).not.toThrow();

    let nest: unknown = toggle("x", p(text("y")));
    for (let i = 0; i < 20; i += 1) nest = toggle("t", nest);
    expect(() => sanitizeDoc(doc(nest))).toThrow(/nested too deeply/);
  });
});

describe("plain-text projection of the new blocks", () => {
  it("includes callout text without its emoji", () => {
    expect(toPlainText(doc(callout(p(text("Watch out")))) as TiptapDoc)).toBe("Watch out");
  });

  it("includes toggle summary and content, open or closed", () => {
    expect(toPlainText(doc(toggle("Details", p(text("secret words")))) as TiptapDoc)).toBe(
      "Details\nsecret words",
    );
  });

  it("writes a table one row per line with cells separated by a space", () => {
    expect(
      toPlainText(
        doc(
          table(
            row(cell("Name", "tableHeader"), cell("Role", "tableHeader")),
            row(cell("Meera"), cell("Design review")),
          ),
        ) as TiptapDoc,
      ),
    ).toBe("Name Role\nMeera Design review");
  });

  it("adds nothing for a table of contents, and a document of only one is empty", () => {
    const d = doc({ type: "tableOfContents" }) as TiptapDoc;
    expect(toPlainText(d)).toBe("");
    expect(isEmptyDoc(d)).toBe(true);
  });
});
