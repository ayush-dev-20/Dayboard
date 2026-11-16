import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/actions/notes", () => ({}));

import { META_FIELD, BODY_FIELD, noteSchema, readLive, seedYDoc } from "@/lib/collab/convert";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]): TiptapDoc => ({ type: "doc", content }) as TiptapDoc;

const SAMPLES: Record<string, TiptapDoc> = {
  paragraph: doc(p("Hello")),
  heading: doc({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Title" }],
  }),
  marks: doc({
    type: "paragraph",
    content: [
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      {
        type: "text",
        text: "link",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
    ],
  }),
  bullets: doc({
    type: "bulletList",
    content: [
      { type: "listItem", content: [p("a")] },
      { type: "listItem", content: [p("b")] },
    ],
  }),
  tasks: doc({
    type: "taskList",
    content: [{ type: "taskItem", attrs: { checked: true }, content: [p("done")] }],
  }),
  codeBlock: doc({
    type: "codeBlock",
    attrs: { language: null },
    content: [{ type: "text", text: "x = 1" }],
  }),
  quote: doc({ type: "blockquote", content: [p("quoted")] }),
  divider: doc({ type: "horizontalRule" }, p("after")),
  callout: doc({ type: "callout", attrs: { emoji: "💡", tone: "info" }, content: [p("note")] }),
  toggle: doc({
    type: "toggle",
    attrs: { level: null },
    content: [
      { type: "toggleSummary", content: [{ type: "text", text: "Summary" }] },
      { type: "toggleContent", content: [p("hidden")] },
    ],
  }),
  tableOfContents: doc(
    { type: "tableOfContents" },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "A" }] },
  ),
  table: doc({
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          { type: "tableHeader", content: [p("h")] },
          { type: "tableHeader", content: [p("i")] },
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
  }),
  noteLink: doc({
    type: "paragraph",
    content: [{ type: "noteLink", attrs: { noteId: "0190a9d2-1111-7000-8000-000000000001" } }],
  }),
  subNote: doc({ type: "subNote", attrs: { noteId: "0190a9d2-1111-7000-8000-000000000002" } }),
};

describe("the shared document and the note", () => {
  it("has a schema with the editor's nodes", () => {
    const nodes = Object.keys(noteSchema().nodes);
    for (const n of [
      "callout",
      "toggle",
      "tableOfContents",
      "noteLink",
      "subNote",
      "table",
      "image",
      "file",
      "bookmark",
    ])
      expect(nodes, n).toContain(n);
  });

  for (const [name, sample] of Object.entries(SAMPLES)) {
    it(`round trips ${name} through Yjs unchanged`, () => {
      const ydoc = seedYDoc({
        contentJson: sanitizeDoc(sample, { allowSubNotes: true }),
        title: "T",
        emoji: null,
      });
      // Through the wire format too: encode the state and load it into a fresh document.
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
      expect(readLive(copy).doc).toEqual(sanitizeDoc(sample, { allowSubNotes: true }));
    });
  }

  it("carries the title and emoji in the meta map", () => {
    const ydoc = seedYDoc({ contentJson: doc(p("x")), title: "Plan", emoji: "🚀" });
    expect(readLive(ydoc)).toMatchObject({ title: "Plan", emoji: "🚀" });
    ydoc.getMap(META_FIELD).set("title", "Renamed");
    ydoc.getMap(META_FIELD).set("emoji", null);
    expect(readLive(ydoc)).toMatchObject({ title: "Renamed", emoji: null });
  });

  it("applying the same update twice changes nothing (replay after a reconnect)", () => {
    const a = seedYDoc({ contentJson: doc(p("base")), title: "", emoji: null });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const before = Y.encodeStateVector(b);
    let update: Uint8Array | null = null;
    a.on("update", (u: Uint8Array) => (update = u));
    a.getXmlFragment(BODY_FIELD).insert(1, [new Y.XmlElement("paragraph")]);
    Y.applyUpdate(b, update!);
    const once = readLive(b).doc;
    Y.applyUpdate(b, update!);
    expect(readLive(b).doc).toEqual(once);
    expect(Y.encodeStateVector(b)).not.toEqual(before);
  });

  it("drops a forged node that the editor does not allow (sanitised on the way out)", () => {
    const ydoc = seedYDoc({ contentJson: doc(p("ok")), title: "", emoji: null });
    const evil = new Y.XmlElement("script");
    ydoc.getXmlFragment(BODY_FIELD).insert(1, [evil]);
    let result: ReturnType<typeof readLive> | null = null;
    try {
      result = readLive(ydoc);
    } catch {
      result = null;
    }
    // Either refused (the caller keeps the last good projection) or cleaned: never present.
    if (result) expect(JSON.stringify(result.doc)).not.toContain("script");
  });
});
