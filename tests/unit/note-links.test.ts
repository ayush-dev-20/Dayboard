import { describe, expect, it } from "vitest";
import { toPlainText, isEmptyDoc } from "@/lib/editor/projection";
import { EditorDocError, sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";
import {
  SNIPPET_MAX,
  allNoteRefs,
  collectNoteRefs,
  displayTitle,
  linkSnippets,
  noteIdFromAddress,
  noteState,
  windowAround,
} from "@/lib/notes/links";
import { rankPickerResults, type PickerCandidate } from "@/lib/notes/picker";

// V2 feature 07: links and sub-note blocks inside documents.

const A = "0192b6a0-0000-7000-8000-00000000000a";
const B = "0192b6a0-0000-7000-8000-00000000000b";
const C = "0192b6a0-0000-7000-8000-00000000000c";

const text = (t: string): TiptapNode => ({ type: "text", text: t });
const link = (noteId: string): TiptapNode => ({ type: "noteLink", attrs: { noteId } });
const para = (...content: TiptapNode[]): TiptapNode => ({ type: "paragraph", content });
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });

describe("reading links out of a document", () => {
  it("lists each linked note once, in the order it first appears", () => {
    const d = doc(para(text("see "), link(B), text(" and "), link(A)), para(link(B)));
    expect(collectNoteRefs(d).links).toEqual([B, A]);
  });

  it("finds links inside toggles, tables and lists", () => {
    const d = doc(
      {
        type: "toggle",
        content: [
          { type: "toggleSummary", content: [link(A)] },
          { type: "toggleContent", content: [para(link(B))] },
        ],
      },
      {
        type: "table",
        content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para(link(C))] }] }],
      },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [para(link(A))] }],
      },
    );
    expect(collectNoteRefs(d).links.sort()).toEqual([A, B, C].sort());
  });

  it("keeps sub-note blocks apart: they are hierarchy, not links", () => {
    const d = doc({ type: "subNote", attrs: { noteId: A } }, para(link(B)));
    const refs = collectNoteRefs(d);
    expect(refs.links).toEqual([B]);
    expect(refs.blocks).toEqual([A]);
    expect(allNoteRefs(d).sort()).toEqual([A, B].sort());
  });

  it("ignores a link with no usable id and handles an empty or missing document", () => {
    expect(collectNoteRefs(doc(para({ type: "noteLink", attrs: { noteId: "nope" } })))).toEqual({
      links: [],
      blocks: [],
    });
    expect(collectNoteRefs(null)).toEqual({ links: [], blocks: [] });
    expect(collectNoteRefs({ type: "doc" })).toEqual({ links: [], blocks: [] });
  });
});

describe("the words around a link", () => {
  const titles = new Map([
    [A, "Roadmap"],
    [B, ""],
  ]);
  const titleOf = (id: string) => titles.get(id);

  it("uses the whole block when it is short, with the link read as the note's title", () => {
    const snippets = linkSnippets(
      doc(para(text("Ship the "), link(A), text(" this week."))),
      titleOf,
    );
    expect(snippets.get(A)).toBe("Ship the Roadmap this week.");
  });

  it("calls an untitled note Untitled", () => {
    expect(linkSnippets(doc(para(link(B))), titleOf).get(B)).toBe("Untitled");
  });

  it("keeps the first occurrence", () => {
    const d = doc(para(text("first "), link(A)), para(text("second "), link(A)));
    expect(linkSnippets(d, titleOf).get(A)).toBe("first Roadmap");
  });

  it("cuts a long block to a window around the link, with ellipses where cut", () => {
    const long = "x".repeat(300);
    const snippet = linkSnippets(doc(para(text(long), link(A), text(long))), titleOf).get(A)!;
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(snippet).toContain("Roadmap");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("windowAround never exceeds the limit, wherever the link is", () => {
    const body = "word ".repeat(200);
    for (const at of [0, 50, body.length - 10]) {
      expect(windowAround(body, at, 7).length).toBeLessThanOrEqual(SNIPPET_MAX);
    }
  });
});

describe("link state", () => {
  it("is ok, archived, trashed or missing", () => {
    expect(noteState({ archivedAt: null, deletedAt: null })).toBe("ok");
    expect(noteState({ archivedAt: new Date(), deletedAt: null })).toBe("archived");
    expect(noteState({ archivedAt: null, deletedAt: new Date() })).toBe("trashed");
    // In Trash wins over archived.
    expect(noteState({ archivedAt: new Date(), deletedAt: new Date() })).toBe("trashed");
    expect(noteState(null)).toBe("missing");
  });

  it("says what a person reads for each state", () => {
    expect(displayTitle({ title: "Plan", state: "ok" })).toBe("Plan");
    expect(displayTitle({ title: "", state: "archived" })).toBe("Untitled");
    expect(displayTitle({ title: "Plan", state: "trashed" })).toBe("Deleted note");
    expect(displayTitle({ title: "", state: "missing" })).toBe("Note no longer exists");
    expect(displayTitle(undefined)).toBe("Note no longer exists");
  });
});

describe("a pasted note address", () => {
  const origins = ["https://app.example.com"];
  it("is a note link when it is this app's own note address", () => {
    expect(noteIdFromAddress(`https://app.example.com/notes/${A}`, origins)).toBe(A);
    expect(noteIdFromAddress(`  https://app.example.com/notes/${A}/ `, origins)).toBe(A);
  });
  it("is not when it is another site, another page, or not an address", () => {
    expect(noteIdFromAddress(`https://evil.example.com/notes/${A}`, origins)).toBeNull();
    expect(noteIdFromAddress(`https://app.example.com/tasks/${A}`, origins)).toBeNull();
    expect(noteIdFromAddress("https://app.example.com/notes/not-an-id", origins)).toBeNull();
    expect(noteIdFromAddress("just some words", origins)).toBeNull();
  });
});

describe("the note picker order", () => {
  const cand = (
    id: string,
    title: string,
    updatedAt: string,
    extra: Partial<PickerCandidate> = {},
  ): PickerCandidate => ({ id, title, emoji: null, path: [], updatedAt, ...extra });
  const items = [
    cand("old", "Plan for launch", "2026-01-01"),
    cand("new", "Budget", "2026-03-01"),
    cand("exact", "Plan", "2026-02-01"),
    cand("body", "Meeting", "2026-04-01"),
    cand("contains", "Replanning", "2026-02-15"),
  ];

  it("with nothing typed, is the most recently touched first", () => {
    expect(rankPickerResults(items, "").map((c) => c.id)).toEqual([
      "body",
      "new",
      "contains",
      "exact",
      "old",
    ]);
  });

  it("with a query, is exact title, then starts with, then contains, then body only", () => {
    expect(rankPickerResults(items, "plan").map((c) => c.id)).toEqual(["exact", "old", "contains"]);
    // The database says which notes only mention the query in their body.
    const withBody = items.map((c) => (c.id === "body" ? { ...c, bodyMatch: true } : c));
    expect(rankPickerResults(withBody, "zzz").map((c) => c.id)).toEqual(["body"]);
    expect(rankPickerResults(withBody, "meet").map((c) => c.id)).toEqual(["body"]);
  });

  it("never offers the note being edited, and respects the limit", () => {
    expect(rankPickerResults(items, "plan", { excludeId: "exact" }).map((c) => c.id)).toEqual([
      "old",
      "contains",
    ]);
    expect(rankPickerResults(items, "", { limit: 2 })).toHaveLength(2);
  });
});

describe("the saved document accepts the two new nodes", () => {
  it("keeps a note link in a paragraph and a sub-note block at the top of a note", () => {
    const d = doc(para(text("a "), link(A)), { type: "subNote", attrs: { noteId: B } });
    expect(sanitizeDoc(d, { allowSubNotes: true })).toEqual(d);
  });

  it("lower-cases the id, and refuses an id that is not a note id", () => {
    const upper = doc(para(link(A.toUpperCase())));
    expect(sanitizeDoc(upper).content?.[0]?.content?.[0]?.attrs?.noteId).toBe(A);
    expect(() => sanitizeDoc(doc(para(link("not-a-uuid"))))).toThrow(EditorDocError);
    expect(() => sanitizeDoc(doc(para({ type: "noteLink" })))).toThrow(EditorDocError);
  });

  it("refuses a sub-note block in a task description, which can only link", () => {
    const d = doc({ type: "subNote", attrs: { noteId: A } });
    expect(() => sanitizeDoc(d)).toThrow(/task description/i);
    expect(() => sanitizeDoc(d, { allowSubNotes: false })).toThrow(EditorDocError);
    expect(() => sanitizeDoc(doc(para(link(A))))).not.toThrow();
  });

  it("puts a sub-note block only at the top or in a toggle, a link only in a line of text", () => {
    const inList = doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "subNote", attrs: { noteId: A } }] }],
    });
    expect(() => sanitizeDoc(inList, { allowSubNotes: true })).toThrow(EditorDocError);
    const inToggle = doc({
      type: "toggle",
      content: [
        { type: "toggleSummary", content: [text("t")] },
        { type: "toggleContent", content: [{ type: "subNote", attrs: { noteId: A } }] },
      ],
    });
    expect(() => sanitizeDoc(inToggle, { allowSubNotes: true })).not.toThrow();
    expect(() => sanitizeDoc(doc({ type: "noteLink", attrs: { noteId: A } }))).toThrow(
      EditorDocError,
    );
  });

  it("a note link has no content of its own", () => {
    const withContent = doc(para({ type: "noteLink", attrs: { noteId: A }, content: [text("x")] }));
    const clean = sanitizeDoc(withContent);
    expect(clean.content?.[0]?.content?.[0]).toEqual(link(A));
  });
});

describe("the searchable text includes titles", () => {
  const titles: Record<string, string> = { [A]: "Roadmap", [B]: "Meeting notes" };
  const titleOf = (id: string) => titles[id];

  it("writes a link's title where the link is", () => {
    expect(toPlainText(doc(para(text("see "), link(A))), titleOf)).toBe("see Roadmap");
  });

  it("writes a sub-note block's title as its own line", () => {
    const d = doc(para(text("intro")), { type: "subNote", attrs: { noteId: B } });
    expect(toPlainText(d, titleOf)).toBe("intro\nMeeting notes");
  });

  it("writes nothing for a note whose title is unknown, and plain text still works without titles", () => {
    expect(toPlainText(doc(para(text("a "), link(C))), titleOf)).toBe("a");
    expect(toPlainText(doc(para(text("plain"))))).toBe("plain");
  });

  it("a document that holds only a link or a block is not empty", () => {
    expect(isEmptyDoc(doc(para(link(A))))).toBe(false);
    expect(isEmptyDoc(doc({ type: "subNote", attrs: { noteId: A } }))).toBe(false);
    expect(isEmptyDoc(doc(para()))).toBe(true);
  });
});
