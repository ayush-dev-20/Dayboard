// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardFidelity } from "@/components/editor/clipboard-extension";
import { createExtensions } from "@/components/editor/extensions";
import { flavoursFor } from "@/lib/editor/clipboard/copy";
import { fitInner, fitTop, subNotesToLinks } from "@/lib/editor/clipboard/fit";
import { linkNoteRefs, type NoteRefReader } from "@/lib/editor/clipboard/note-refs";
import { INTERNAL_MIME, decodeInternal } from "@/lib/editor/clipboard/slice";
import type { PasteContext } from "@/lib/editor/clipboard/rules";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// V2 feature 07 §4 and feature 02: a note link and a sub-note block copy out as ordinary links,
// paste back in intact, are never left as a block in a task description, and a pasted Dayboard
// note address becomes a link.

vi.mock("@/actions/notes", () => ({
  createLinkedNoteForTask: vi.fn(),
  createNote: vi.fn(),
  createSubNote: vi.fn(),
  findNotesForLink: vi.fn(async () => ({ ok: true, data: [] })),
  getNoteMetas: vi.fn(async () => ({ ok: true, data: [] })),
  restoreNote: vi.fn(),
  restoreNoteAsTopLevel: vi.fn(),
}));

const A = "0192b6a0-0000-7000-8000-00000000000a";
const B = "0192b6a0-0000-7000-8000-00000000000b";
const ME = "0192b6a0-0000-7000-8000-0000000000ff";
const ORIGIN = "https://app.test";

const titles: Record<string, string> = { [A]: "Roadmap", [B]: "Meeting notes" };
const refs: NoteRefReader & { origins: readonly string[] } = {
  origin: ORIGIN,
  origins: [ORIGIN],
  label: (id) => titles[id] ?? "Note",
};

const t = (text: string): TiptapNode => ({ type: "text", text });
const link = (noteId: string): TiptapNode => ({ type: "noteLink", attrs: { noteId } });
const block = (noteId: string): TiptapNode => ({ type: "subNote", attrs: { noteId } });
const p = (...content: TiptapNode[]): TiptapNode => ({ type: "paragraph", content });
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });

describe("copy out", () => {
  it("writes a link as an ordinary link with the note's title, and keeps the real node for Dayboard", () => {
    const content = [p(t("see "), link(A), t(" now"))];
    const out = flavoursFor(content, 0, 0, refs);
    expect(out.html).toBe(`<p>see <a href="${ORIGIN}/notes/${A}">Roadmap</a> now</p>`);
    expect(out.text).toBe(`see [Roadmap](${ORIGIN}/notes/${A}) now`);
    const back = decodeInternal(out.internal);
    expect(JSON.stringify(back?.doc.content)).toContain('"noteLink"');
  });

  it("writes a sub-note block as a paragraph holding a link", () => {
    const out = flavoursFor([block(B)], 0, 0, refs);
    expect(out.html).toBe(`<p><a href="${ORIGIN}/notes/${B}">Meeting notes</a></p>`);
    expect(out.text).toBe(`[Meeting notes](${ORIGIN}/notes/${B})`);
  });

  it("works inside lists, toggles and tables, and for a selection inside one line", () => {
    const nested = linkNoteRefs(
      [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(link(A))] }],
        },
      ],
      refs,
    );
    expect(JSON.stringify(nested)).not.toContain("noteLink");
    // A selection of just the link (open at both ends) is inline HTML, no paragraph.
    const inline = flavoursFor([p(link(A))], 1, 1, refs);
    expect(inline.html).toBe(`<a href="${ORIGIN}/notes/${A}">Roadmap</a>`);
  });

  it("names a note it knows nothing about plainly", () => {
    const out = flavoursFor([p(link("0192b6a0-0000-7000-8000-0000000000aa"))], 0, 0, refs);
    expect(out.html).toContain(">Note</a>");
  });

  it("without a reader, nothing changes (the tests of feature 02 are untouched)", () => {
    const out = flavoursFor([p(t("plain"))], 0, 0);
    expect(out.html).toBe("<p>plain</p>");
  });
});

describe("a place that cannot hold a sub-note block", () => {
  it("a task description gets a link to the same note, even inside a toggle", () => {
    const toggle: TiptapNode = {
      type: "toggle",
      content: [
        { type: "toggleSummary", content: [t("More")] },
        { type: "toggleContent", content: [block(A)] },
      ],
    };
    const out = subNotesToLinks([block(B), toggle]);
    expect(out[0]).toEqual(p(link(B)));
    expect(JSON.stringify(out[1])).toContain('"noteLink"');
    expect(JSON.stringify(out)).not.toContain("subNote");
  });

  it("a list or quote can't hold the block either: it becomes a line with the link", () => {
    const fitted = fitInner([block(A), p(t("x"))]);
    expect(fitted[0]).toEqual(p(link(A)));
    // At the top of a note it stays a block.
    expect(fitTop([block(A)])).toEqual([block(A)]);
  });
});

// ---- A real editor ---------------------------------------------------------------------------

const editors: Editor[] = [];

function makeEditor(content: TiptapDoc, ctx: Partial<PasteContext> = {}): Editor {
  const editor = new Editor({
    extensions: [
      ...createExtensions("", { interactive: false }),
      ClipboardFidelity.configure({
        getContext: () => ({
          surface: "note",
          ownerId: ME,
          offline: false,
          noteRefs: refs,
          ...ctx,
        }),
        onNotice: () => {},
      }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

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
function fire(editor: Editor, type: "paste" | "copy", data: ReturnType<typeof transfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  editor.view.dom.dispatchEvent(event);
  return event;
}
const paste = (editor: Editor, flavours: Flavours) => fire(editor, "paste", transfer(flavours));
const json = (editor: Editor) => editor.getJSON() as TiptapDoc;
const endOfDoc = (editor: Editor) => editor.commands.focus("end");

describe("copy and paste in a real editor", () => {
  it("copying a note with a link and a sub-note block writes links, and pasting back keeps both", () => {
    const source = makeEditor(doc(p(t("see "), link(A)), block(B)));
    source.commands.selectAll();
    const data = transfer();
    fire(source, "copy", data);
    expect(data.data["text/html"]).toContain(`href="${ORIGIN}/notes/${A}"`);
    expect(data.data["text/html"]).toContain(`href="${ORIGIN}/notes/${B}"`);

    const target = makeEditor(doc(p()));
    paste(target, data.data);
    const out = JSON.stringify(json(target));
    expect(out).toContain(`"noteLink"`);
    expect(out).toContain(`"subNote"`);
    expect(out).toContain(A);
    expect(out).toContain(B);
  });

  it("pasting a sub-note block into a task description leaves a link, not a block", () => {
    const source = makeEditor(doc(block(B)));
    source.commands.selectAll();
    const data = transfer();
    fire(source, "copy", data);

    const task = makeEditor(doc(p()), { surface: "task", ownerId: "task-1" });
    paste(task, { [INTERNAL_MIME]: data.data[INTERNAL_MIME]!, "text/plain": "x" });
    const out = JSON.stringify(json(task));
    expect(out).not.toContain("subNote");
    expect(out).toContain('"noteLink"');
  });

  it("a Dayboard note address pasted as plain text becomes a link to that note", () => {
    const editor = makeEditor(doc(p(t("a "))));
    endOfDoc(editor);
    paste(editor, { "text/plain": `${ORIGIN}/notes/${A}` });
    const nodes = json(editor).content?.[0]?.content ?? [];
    expect(nodes.some((n) => n.type === "noteLink" && n.attrs?.noteId === A)).toBe(true);
    expect(JSON.stringify(nodes)).not.toContain('"link"'); // not a plain web link
  });

  it("a note's own address pasted into that note stays plain text (no link to itself)", () => {
    const editor = makeEditor(doc(p()));
    endOfDoc(editor);
    paste(editor, { "text/plain": `${ORIGIN}/notes/${ME}` });
    expect(JSON.stringify(json(editor))).not.toContain("noteLink");
    expect(editor.getText()).toContain(`/notes/${ME}`);
  });

  it("an address from another site, or over selected text, is not turned into a note link", () => {
    const editor = makeEditor(doc(p(t("word"))));
    endOfDoc(editor);
    paste(editor, { "text/plain": `https://evil.test/notes/${A}` });
    expect(JSON.stringify(json(editor))).not.toContain("noteLink");

    const over = makeEditor(doc(p(t("select me"))));
    over.commands.selectAll();
    paste(over, { "text/plain": `${ORIGIN}/notes/${A}` });
    expect(JSON.stringify(json(over))).not.toContain("noteLink");
    expect(JSON.stringify(json(over))).toContain(`${ORIGIN}/notes/${A}`); // an ordinary link
  });
});
