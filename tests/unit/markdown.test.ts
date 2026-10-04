import { describe, expect, it } from "vitest";
import { sanitizeDoc } from "@/lib/editor/schema";
import { toPlainText } from "@/lib/editor/projection";
import { convertMarkdown, markdownToDoc } from "@/lib/editor/markdown";
import type { TiptapNode } from "@/lib/editor/types";

const blocks = (md: string, final = true) => markdownToDoc(md, { final }).content ?? [];
const types = (md: string) => blocks(md).map((b) => b.type);
const inline = (md: string) => blocks(md)[0]!.content!;

describe("blocks", () => {
  it("turns # headings into levels 1 to 3, deeper ones into 3", () => {
    const h = blocks("# One\n\n## Two\n\n### Three\n\n###### Six");
    expect(h.map((b) => b.attrs?.level)).toEqual([1, 2, 3, 3]);
    expect(h.every((b) => b.type === "heading")).toBe(true);
  });

  it("joins lines of one paragraph with spaces and splits on blank lines", () => {
    const p = blocks("first line\nsecond line\n\nnext paragraph");
    expect(p).toHaveLength(2);
    expect(p[0]!.content![0]!.text).toBe("first line second line");
  });

  it("builds bulleted, numbered and checklist lists", () => {
    const [bullets, numbers, tasks] = blocks(
      "- a\n- b\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done",
    );
    expect(bullets!.type).toBe("bulletList");
    expect(bullets!.content).toHaveLength(2);
    expect(numbers!.type).toBe("orderedList");
    expect(tasks!.type).toBe("taskList");
    expect(tasks!.content!.map((i) => i.attrs?.checked)).toEqual([false, true]);
  });

  it("keeps an ordered list's start number", () => {
    expect(blocks("3. three\n4. four")[0]!.attrs).toEqual({ start: 3 });
    expect(blocks("1. one")[0]!.attrs).toBeUndefined();
  });

  it("nests bullet lists up to three levels and flattens deeper ones", () => {
    const md = "- a\n  - b\n    - c\n      - d\n      - e";
    const [list] = blocks(md);
    const depth = (n: TiptapNode): number =>
      1 +
      Math.max(
        0,
        ...(n.content ?? []).flatMap((i) =>
          (i.content ?? []).filter((c) => /List$/.test(c.type)).map(depth),
        ),
      );
    expect(depth(list!)).toBeLessThanOrEqual(3);
    expect(toPlainText({ type: "doc", content: [list!] })).toContain("e");
  });

  it("never nests inside a checklist: nested items flatten into it", () => {
    const [list] = blocks("- [ ] parent\n  - [x] child\n  - plain child");
    expect(list!.type).toBe("taskList");
    expect(list!.content!.map((i) => i.type)).toEqual(["taskItem", "taskItem", "taskItem"]);
  });

  it("a type change starts a new list", () => {
    expect(types("- a\n1. b")).toEqual(["bulletList", "orderedList"]);
  });

  it("quotes hold paragraphs and lists", () => {
    const [q] = blocks("> first\n> second\n>\n> - item");
    expect(q!.type).toBe("blockquote");
    expect(q!.content!.map((c) => c.type)).toContain("bulletList");
  });

  it("fenced code is verbatim, with an optional language", () => {
    const [withLang, plain] = blocks("```ts\nconst a = **1**;\n```\n\n```\nplain\n```");
    expect(withLang!.attrs).toEqual({ language: "ts" });
    expect(withLang!.content![0]!.text).toBe("const a = **1**;");
    expect(plain!.attrs).toBeUndefined();
  });

  it("rules", () => {
    expect(types("a\n\n---\n\nb")).toEqual(["paragraph", "horizontalRule", "paragraph"]);
    expect(types("***")).toEqual(["horizontalRule"]);
  });
});

describe("inline marks", () => {
  it("bold, italic, strike and code", () => {
    const nodes = inline("a **b** *c* _d_ ~~e~~ `f`");
    const find = (t: string) => nodes.find((n) => n.text === t);
    expect(find("b")!.marks).toEqual([{ type: "bold" }]);
    expect(find("c")!.marks).toEqual([{ type: "italic" }]);
    expect(find("d")!.marks).toEqual([{ type: "italic" }]);
    expect(find("e")!.marks).toEqual([{ type: "strike" }]);
    expect(find("f")!.marks).toEqual([{ type: "code" }]);
  });

  it("nests marks, but code stands alone", () => {
    const nodes = inline("**bold *and italic***");
    expect(
      nodes
        .find((n) => n.text === "and italic")!
        .marks!.map((m) => m.type)
        .sort(),
    ).toEqual(["bold", "italic"]);
    const code = inline("**`x`**")[0]!;
    expect(code.marks).toEqual([{ type: "code" }]);
  });

  it("keeps allowed links and drops unsafe ones, keeping their text", () => {
    const ok = inline("[site](https://example.com)")[0]!;
    expect(ok.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test"]) {
      const node = inline(`[click](${bad})`)[0]!;
      expect(node.text).toBe("click");
      expect(node.marks).toBeUndefined();
    }
  });

  it("leaves snake_case and lone symbols alone", () => {
    expect(inline("use snake_case_names here")[0]!.text).toBe("use snake_case_names here");
    expect(inline("2 * 3 = 6")[0]!.text).toBe("2 * 3 = 6");
  });

  it("handles escapes", () => {
    expect(inline("\\*not italic\\*")[0]!.text).toBe("*not italic*");
  });
});

describe("things the editor cannot hold are converted, never passed through", () => {
  it("a table becomes a bold header line and a list of rows", () => {
    const out = blocks("| Name | Role |\n| --- | --- |\n| Meera | Design |\n| Ravi | Eng |");
    expect(out.map((b) => b.type)).toEqual(["paragraph", "bulletList"]);
    expect(out[0]!.content![0]!.marks).toEqual([{ type: "bold" }]);
    expect(toPlainText({ type: "doc", content: out })).toContain("Meera · Design");
  });

  it("an image becomes its alt text", () => {
    expect(inline("see ![the chart](https://x.test/a.png) here")[0]!.text).toBe(
      "see the chart here",
    );
  });

  it("HTML is stripped to its text, but kept inside code", () => {
    expect(inline("a <b>bold</b> <br/>word")[0]!.text).toBe("a bold  word");
    expect(inline("`<div>`")[0]!.text).toBe("<div>");
  });
});

describe("streaming", () => {
  const sample = [
    "# Title",
    "",
    "Intro with **bold**, *italic* and a [link](https://example.com).",
    "",
    "- first",
    "  - nested",
    "- second",
    "",
    "1. one",
    "2. two",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "> a quote",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "---",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "Last paragraph.",
    "",
  ].join("\n");

  it("fed one character at a time it never throws, always passes the sanitizer, and converges", () => {
    for (let i = 0; i <= sample.length; i += 1) {
      const doc = markdownToDoc(sample.slice(0, i), { final: false });
      expect(() => sanitizeDoc(doc)).not.toThrow();
    }
    expect(markdownToDoc(sample, { final: false })).toEqual(markdownToDoc(sample, { final: true }));
  });

  it("shows no half-formed marks on the unfinished last line", () => {
    for (const partial of [
      "see **bol",
      "an *ital",
      "code `x",
      "a [lin",
      "a [link](http",
      "~~str",
    ]) {
      const text = toPlainText(markdownToDoc(partial, { final: false }));
      expect(text, partial).not.toMatch(/\*\*|`|\[|~~/);
    }
    expect(toPlainText(markdownToDoc("a [link](http", { final: false }))).toBe("a link");
  });

  it("an open code fence shows its lines so far", () => {
    const [code] = blocks("```py\nprint(1)\nprint(", false);
    expect(code!.type).toBe("codeBlock");
    expect(code!.content![0]!.text).toBe("print(1)\nprint(");
  });

  it("treats the same text differently only in the last line", () => {
    expect(toPlainText(markdownToDoc("a **b**", { final: true }))).toBe("a b");
    expect(toPlainText(markdownToDoc("a **b", { final: false }))).toBe("a b");
  });
});

describe("limits and odd input", () => {
  it("empty and whitespace input give an empty document", () => {
    expect(markdownToDoc("").content).toEqual([]);
    expect(markdownToDoc("   \n\n  ").content).toEqual([]);
  });

  it("never throws on hostile input", () => {
    for (const input of [
      "*".repeat(5000),
      "[".repeat(3000),
      "`".repeat(999),
      "- ".repeat(2000),
      ">".repeat(500),
      "#".repeat(200),
      "\u0000​\ud800",
      "|".repeat(100),
    ]) {
      expect(() => markdownToDoc(input)).not.toThrow();
      expect(() => sanitizeDoc(markdownToDoc(input))).not.toThrow();
    }
  });

  it("cuts oversize output at a block boundary and says so", () => {
    const big = Array.from(
      { length: 6000 },
      (_, i) => `Paragraph number ${i} with some words in it to take up room.`,
    ).join("\n\n");
    const result = convertMarkdown(big);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result.doc)).length).toBeLessThanOrEqual(
      200_000,
    );
    expect(result.doc.content!.at(-1)!.type).toBe("paragraph");
  });

  it("deep quotes stay within the editor's depth", () => {
    expect(() => sanitizeDoc(markdownToDoc("> > > > > > deep"))).not.toThrow();
  });
});
