import { describe, expect, it } from "vitest";
import { fitInner } from "@/lib/editor/clipboard/fit";
import { blocksToInline } from "@/lib/editor/clipboard/inline";
import { serializeHtml } from "@/lib/editor/clipboard/serialize-html";
import { serializeMarkdown } from "@/lib/editor/clipboard/serialize-markdown";
import { isEmptyDoc, toPlainText } from "@/lib/editor/projection";
import { EditorDocError, sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// V2 feature 09: the picture, file and bookmark blocks in documents.

const ID = "0192b6a0-0000-7000-8000-00000000000a";
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });
const image = (attrs: Record<string, unknown>): TiptapNode => ({ type: "image", attrs });
const file = (attrs: Record<string, unknown>): TiptapNode => ({ type: "file", attrs });
const bookmark = (attrs: Record<string, unknown>): TiptapNode => ({ type: "bookmark", attrs });
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function attrsOf(node: TiptapNode | undefined) {
  return node?.attrs ?? {};
}

describe("image blocks", () => {
  it("keep a lowercased id, a tidy caption and a width in pixels", () => {
    const out = sanitizeDoc(
      doc(image({ attachmentId: ID.toUpperCase(), caption: "  A   cat \n here ", width: 320 })),
    );
    expect(attrsOf(out.content?.[0])).toEqual({
      attachmentId: ID,
      caption: "A cat here",
      width: 320,
    });
  });

  it("keep a width of whole pixels from 64 to 4000, and drop any other (which means automatic size)", () => {
    for (const width of [64, 65, 300, 1200, 4000]) {
      const out = sanitizeDoc(doc(image({ attachmentId: ID, width })));
      expect(attrsOf(out.content?.[0])).toEqual({ attachmentId: ID, width });
    }
    for (const width of [0, 10, 63, 4001, 99999, 320.5, "320", null, -5]) {
      const out = sanitizeDoc(doc(image({ attachmentId: ID, width })));
      expect(attrsOf(out.content?.[0])).toEqual({ attachmentId: ID });
    }
  });

  it("cap a caption at 500 characters and drop an empty one", () => {
    const long = sanitizeDoc(doc(image({ attachmentId: ID, caption: "x".repeat(900) })));
    expect((attrsOf(long.content?.[0]).caption as string).length).toBe(500);
    const empty = sanitizeDoc(doc(image({ attachmentId: ID, caption: "   " })));
    expect(attrsOf(empty.content?.[0])).toEqual({ attachmentId: ID });
  });

  it.each([
    ["no id", {}],
    ["an address instead of an id", { attachmentId: "https://example.com/a.png" }],
    ["a path", { attachmentId: "../../etc/passwd" }],
    ["a number", { attachmentId: 5 }],
    ["a src", { src: "x.png" }],
  ])("are refused with %s", (_label, attrs) => {
    expect(() => sanitizeDoc(doc(image(attrs)))).toThrow(EditorDocError);
  });

  it("do not keep unknown attributes", () => {
    const out = sanitizeDoc(
      doc(image({ attachmentId: ID, src: "javascript:alert(1)", onerror: "x" })),
    );
    expect(attrsOf(out.content?.[0])).toEqual({ attachmentId: ID });
  });
});

describe("file blocks", () => {
  it("hold only an attachment id", () => {
    const out = sanitizeDoc(doc(file({ attachmentId: ID, name: "x.pdf", href: "http://x" })));
    expect(attrsOf(out.content?.[0])).toEqual({ attachmentId: ID });
    expect(() => sanitizeDoc(doc(file({ attachmentId: "nope" })))).toThrow(EditorDocError);
  });

  it("cannot sit inside a list item or a callout", () => {
    const inList = doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [file({ attachmentId: ID })] }],
    });
    expect(() => sanitizeDoc(inList)).toThrow(EditorDocError);
  });
});

describe("bookmark blocks", () => {
  const good = {
    url: "https://example.com/a",
    title: " A  title ",
    description: "About it",
    siteName: "Example",
    favicon: PIXEL,
    fetchedAt: "2026-10-08T10:00:00Z",
  };

  it("keep a clean snapshot of the preview", () => {
    const out = sanitizeDoc(doc(bookmark(good)));
    expect(attrsOf(out.content?.[0])).toEqual({
      ...good,
      title: "A title",
      fetchedAt: "2026-10-08T10:00:00.000Z",
    });
  });

  it("need only an address (a card whose preview failed)", () => {
    const out = sanitizeDoc(doc(bookmark({ url: "http://example.com" })));
    expect(attrsOf(out.content?.[0])).toEqual({ url: "http://example.com" });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://example.com",
    "https://user:pw@example.com/",
    "example.com",
    "",
  ])("refuse the address %s", (url) => {
    expect(() => sanitizeDoc(doc(bookmark({ url })))).toThrow(EditorDocError);
  });

  it.each([
    ["an SVG icon", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["a web icon", "https://example.com/favicon.ico"],
    ["an HTML data URI", "data:text/html;base64,PHNjcmlwdD4="],
    ["an icon that is too big", `data:image/png;base64,${"A".repeat(12_100)}`],
  ])("refuse %s as the icon", (_label, favicon) => {
    expect(() => sanitizeDoc(doc(bookmark({ url: "https://example.com", favicon })))).toThrow(
      EditorDocError,
    );
  });
});

describe("what the blocks add to search text and emptiness", () => {
  it("indexes a caption and a bookmark's title and description, not ids or addresses", () => {
    const text = toPlainText(
      doc(
        image({ attachmentId: ID, caption: "Whiteboard after the meeting" }),
        file({ attachmentId: ID }),
        bookmark({
          url: "https://example.com/secret-path",
          title: "Quarterly plan",
          description: "Goals",
        }),
      ),
    );
    expect(text).toContain("Whiteboard after the meeting");
    expect(text).toContain("Quarterly plan");
    expect(text).toContain("Goals");
    expect(text).not.toContain(ID);
    expect(text).not.toContain("secret-path");
  });

  it("is not empty when it holds only a picture, a file or a bookmark", () => {
    expect(isEmptyDoc(doc(image({ attachmentId: ID })))).toBe(false);
    expect(isEmptyDoc(doc(file({ attachmentId: ID })))).toBe(false);
    expect(isEmptyDoc(doc(bookmark({ url: "https://example.com" })))).toBe(false);
  });
});

describe("copying and fitting the blocks", () => {
  const card = bookmark({ url: "https://example.com/a", title: "A title" });

  it("a bookmark leaves as a link in HTML and Markdown; a picture and a file leave nothing", () => {
    expect(serializeHtml([card])).toBe('<p><a href="https://example.com/a">A title</a></p>');
    expect(serializeMarkdown([card])).toBe("[A title](https://example.com/a)");
    expect(serializeHtml([image({ attachmentId: ID }), file({ attachmentId: ID })])).toBe("");
    expect(serializeMarkdown([image({ attachmentId: ID }), file({ attachmentId: ID })])).toBe("");
  });

  it("a bookmark whose address is not a web address is not written out", () => {
    expect(serializeHtml([bookmark({ url: "javascript:alert(1)", title: "x" })])).toBe("");
  });

  it("inside a list or quote a bookmark is a line with a link and a picture keeps its caption", () => {
    const out = fitInner([
      card,
      image({ attachmentId: ID, caption: "Cap" }),
      file({ attachmentId: ID }),
    ]);
    expect(out.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    expect(out[0]?.content?.[0]).toMatchObject({
      text: "A title",
      marks: [{ type: "link", attrs: { href: "https://example.com/a" } }],
    });
    expect(out[1]?.content?.[0]?.text).toBe("Cap");
  });

  it("where only a line of text fits a bookmark is its link, and pictures and files are dropped", () => {
    const inline = blocksToInline([card, image({ attachmentId: ID }), file({ attachmentId: ID })]);
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ text: "A title" });
  });
});
