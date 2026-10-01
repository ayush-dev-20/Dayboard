import { describe, expect, it } from "vitest";
import {
  MAX_DEPTH,
  MAX_DOC_BYTES,
  EditorDocError,
  richTextSchema,
  sanitizeDoc,
} from "@/lib/editor/schema";
import { isEmptyDoc, toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";

const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("sanitizeDoc", () => {
  it("accepts everything the editor can produce", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
      p(
        text("bold", [{ type: "bold" }]),
        text(" "),
        text("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ),
      { type: "bulletList", content: [{ type: "listItem", content: [p(text("one"))] }] },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ type: "listItem", content: [p(text("three"))] }],
      },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] }],
      },
      { type: "blockquote", content: [p(text("quote"))] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1")] },
      { type: "horizontalRule" },
      p(
        text("a"),
        { type: "hardBreak" },
        text("b", [
          { type: "code" },
          { type: "underline" },
          { type: "strike" },
          { type: "italic" },
        ]),
      ),
    );
    expect(sanitizeDoc(input)).toEqual(input);
  });

  it("returns a clean copy and drops attributes it doesn't know", () => {
    const result = sanitizeDoc(
      doc({
        type: "paragraph",
        attrs: { style: "color:red", onclick: "x()" },
        content: [
          text("hi", [
            {
              type: "link",
              attrs: { href: "https://example.com", target: "_blank", rel: "x", class: "evil" },
            },
          ]),
        ],
      }),
    );
    expect(result).toEqual(
      doc({
        type: "paragraph",
        content: [text("hi", [{ type: "link", attrs: { href: "https://example.com" } }])],
      }),
    );
  });

  it("allows an empty document", () => {
    expect(sanitizeDoc({ type: "doc" })).toEqual({ type: "doc", content: [] });
    expect(sanitizeDoc(doc())).toEqual({ type: "doc", content: [] });
  });

  it.each([
    ["an unknown node", doc({ type: "image", attrs: { src: "x.png" } })],
    ["a script node", doc({ type: "script", content: [text("alert(1)")] })],
    ["an unknown mark", doc(p(text("x", [{ type: "highlight" }])))],
    [
      "a javascript link",
      doc(p(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
    ],
    ["a data link", doc(p(text("x", [{ type: "link", attrs: { href: "data:text/html,<b>" } }])))],
    ["a relative link", doc(p(text("x", [{ type: "link", attrs: { href: "/etc/passwd" } }])))],
    ["a link without href", doc(p(text("x", [{ type: "link" }])))],
    ["heading level 4", doc({ type: "heading", attrs: { level: 4 }, content: [text("x")] })],
    ["heading without level", doc({ type: "heading", content: [text("x")] })],
    ["an empty text node", doc(p({ type: "text", text: "" }))],
    ["a text node without text", doc(p({ type: "text" }))],
    ["a non-doc root", p(text("x"))],
    ["null", null],
    ["a string", "<p>hi</p>"],
    ["content that isn't a list", { type: "doc", content: "x" }],
    ["marks that aren't a list", doc(p({ type: "text", text: "x", marks: "bold" }))],
  ])("rejects %s", (_name, input) => {
    expect(() => sanitizeDoc(input)).toThrow(EditorDocError);
  });

  it("rejects documents nested too deeply, and accepts the limit", () => {
    const nest = (levels: number): unknown => {
      let node: unknown = p(text("x"));
      for (let i = 0; i < levels; i++) node = { type: "blockquote", content: [node] };
      return node;
    };
    expect(() => sanitizeDoc(doc(nest(MAX_DEPTH + 1)))).toThrow(/nested too deeply/);
    expect(() => sanitizeDoc(doc(nest(MAX_DEPTH - 3)))).not.toThrow();
  });

  it("rejects oversize documents", () => {
    const big = doc(p(text("x".repeat(MAX_DOC_BYTES))));
    expect(() => sanitizeDoc(big)).toThrow(/too long/);
  });

  it("explains problems in plain words", () => {
    try {
      sanitizeDoc(doc({ type: "iframe" }));
    } catch (error) {
      expect((error as Error).message).toBe("This document has content that isn't supported.");
    }
  });
});

describe("richTextSchema", () => {
  it("parses a good document and reports a bad one as a field error", () => {
    expect(richTextSchema.parse(doc(p(text("ok"))))).toEqual(doc(p(text("ok"))));

    const result = richTextSchema.safeParse(doc({ type: "iframe" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/isn't supported/);
  });
});

describe("toPlainText", () => {
  const plain = (d: unknown) => toPlainText(d as TiptapDoc);

  it("puts each block on its own line", () => {
    expect(
      plain(
        doc(
          { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
          p(text("One")),
          p(text("Two")),
        ),
      ),
    ).toBe("Title\nOne\nTwo");
  });

  it("flattens marks and links to their text", () => {
    expect(
      plain(
        doc(
          p(
            text("a ", [{ type: "bold" }]),
            text("link", [{ type: "link", attrs: { href: "https://x.test" } }]),
          ),
        ),
      ),
    ).toBe("a link");
  });

  it("marks list items", () => {
    expect(
      plain(
        doc(
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [p(text("a"))] },
              { type: "listItem", content: [p(text("b"))] },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              { type: "listItem", content: [p(text("c"))] },
              { type: "listItem", content: [p(text("d"))] },
            ],
          },
        ),
      ),
    ).toBe("- a\n- b\n3. c\n4. d");
  });

  it("shows checklist state", () => {
    expect(
      plain(
        doc({
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [p(text("open"))] },
            { type: "taskItem", attrs: { checked: true }, content: [p(text("closed"))] },
          ],
        }),
      ),
    ).toBe("[ ] open\n[x] closed");
  });

  it("keeps code, quotes and line breaks", () => {
    expect(
      plain(
        doc(
          { type: "codeBlock", content: [text("a\nb")] },
          { type: "blockquote", content: [p(text("q"))] },
          p(text("x"), { type: "hardBreak" }, text("y")),
        ),
      ),
    ).toBe("a\nb\nq\nx\ny");
  });

  it("collapses runs of blank lines", () => {
    expect(plain(doc(p(text("a")), p(), p(), p(), p(text("b"))))).toBe("a\n\nb");
  });

  it("is empty for an empty document", () => {
    expect(plain(doc())).toBe("");
    expect(plain(doc(p()))).toBe("");
  });
});

describe("isEmptyDoc", () => {
  it("is true when there is no visible text", () => {
    expect(isEmptyDoc(doc() as TiptapDoc)).toBe(true);
    expect(isEmptyDoc(doc(p()) as TiptapDoc)).toBe(true);
    expect(isEmptyDoc(doc(p(text("   "))) as TiptapDoc)).toBe(true);
  });

  it("is false with text or a divider", () => {
    expect(isEmptyDoc(doc(p(text("hi"))) as TiptapDoc)).toBe(false);
    expect(isEmptyDoc(doc({ type: "horizontalRule" }) as TiptapDoc)).toBe(false);
  });
});
