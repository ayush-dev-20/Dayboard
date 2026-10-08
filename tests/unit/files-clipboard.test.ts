// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardFidelity } from "@/components/editor/clipboard-extension";
import { FileDrop, registerFileBlocks } from "@/components/editor/blocks/file-blocks";
import { applyPasteChoice, closePasteChoice } from "@/components/editor/blocks/paste-choice";
import { createExtensions } from "@/components/editor/extensions";
import { getBlocks } from "@/components/editor/blocks/registry";
import { DEFAULT_EDITOR_CONTEXT } from "@/components/editor/blocks/context";
import type { TiptapDoc } from "@/lib/editor/types";

const mocks = vi.hoisted(() => ({
  startUpload: vi.fn(() => "0192b6a0-0000-7000-8000-0000000000aa"),
  fetchLinkPreview: vi.fn(),
}));

vi.mock("@/actions/notes", () => ({
  createLinkedNoteForTask: vi.fn(),
  createNote: vi.fn(),
  createSubNote: vi.fn(),
  findNotesForLink: vi.fn(async () => ({ ok: true, data: [] })),
  getNoteMetas: vi.fn(async () => ({ ok: true, data: [] })),
  restoreNote: vi.fn(),
  restoreNoteAsTopLevel: vi.fn(),
}));
vi.mock("@/components/files/upload-manager", () => ({
  startUpload: mocks.startUpload,
  useUpload: () => undefined,
  cancelUpload: vi.fn(),
  retryUpload: vi.fn(),
  dismissUpload: vi.fn(),
}));
vi.mock("@/components/files/api", () => ({ fetchLinkPreview: mocks.fetchLinkPreview }));

// V2 feature 09 against a real ProseMirror editor: a pasted or dropped picture becomes an upload and a
// block; a lone pasted address offers a choice; the slash items appear only when files are on.

registerFileBlocks();

const ATTACHMENT = "0192b6a0-0000-7000-8000-0000000000aa";
const OWNER = "0192b6a0-0000-7000-8000-0000000000bb";
const editors: Editor[] = [];

function makeEditor(options: {
  filesEnabled: boolean;
  content?: TiptapDoc;
  ownerId?: string | null;
}) {
  const context = {
    ...DEFAULT_EDITOR_CONTEXT,
    surface: "note" as const,
    ownerId: options.ownerId === undefined ? OWNER : options.ownerId,
    filesEnabled: options.filesEnabled,
  };
  const editor = new Editor({
    extensions: [
      ...createExtensions("", { interactive: false }),
      ClipboardFidelity.configure({ getContext: () => context, onNotice: () => {} }),
      FileDrop.configure({ getContext: () => context }),
    ],
    content: options.content ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
  editors.push(editor);
  return editor;
}

beforeEach(() => {
  // jsdom has no layout: a drop position can't be measured, so the block goes at the cursor.
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
  mocks.startUpload.mockClear();
  mocks.fetchLinkPreview.mockReset();
});
afterEach(() => {
  closePasteChoice();
  editors.splice(0).forEach((e) => e.destroy());
});

function transfer(data: Record<string, string> = {}, files: File[] = []) {
  return {
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    files,
    getData: (type: string) => data[type] ?? "",
    setData: () => {},
    clearData: () => {},
  };
}

function paste(editor: Editor, data: ReturnType<typeof transfer>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  editor.view.dom.dispatchEvent(event);
  return event;
}

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
const types = (editor: Editor) => (editor.getJSON().content ?? []).map((n) => n.type);

describe("pasting a picture", () => {
  it("starts an upload for the note and puts an image block at the cursor", async () => {
    const editor = makeEditor({ filesEnabled: true });
    const event = paste(editor, transfer({}, [png()]));
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(types(editor)).toContain("image"));
    expect(mocks.startUpload).toHaveBeenCalledWith(expect.any(File), { type: "NOTE", id: OWNER });
    const block = (editor.getJSON().content ?? []).find((n) => n.type === "image");
    expect(block?.attrs).toMatchObject({ attachmentId: ATTACHMENT });
    // A line to type on stays below it.
    expect(types(editor).at(-1)).toBe("paragraph");
  });

  it("does nothing when files are switched off, and leaves the paste alone", () => {
    const editor = makeEditor({ filesEnabled: false });
    const event = paste(editor, transfer({}, [png()]));
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.startUpload).not.toHaveBeenCalled();
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("lets the text win when a copied range carries both text and a picture of itself", () => {
    const editor = makeEditor({ filesEnabled: true });
    paste(editor, transfer({ "text/plain": "a1\tb1" }, [png()]));
    expect(mocks.startUpload).not.toHaveBeenCalled();
    expect(types(editor)).not.toContain("image");
  });

  it("refuses a file that is not a picture and starts nothing", async () => {
    const editor = makeEditor({ filesEnabled: true });
    const exe = new File(["MZ"], "run.exe", { type: "application/x-msdownload" });
    paste(editor, transfer({}, [exe]));
    await Promise.resolve();
    expect(mocks.startUpload).not.toHaveBeenCalled();
  });
});

describe("pasting a web address", () => {
  const URL_TEXT = "https://example.com/article";

  it("on an empty line keeps it as a link and offers the choice", () => {
    const editor = makeEditor({ filesEnabled: false });
    const event = paste(editor, transfer({ "text/plain": URL_TEXT }));
    expect(event.defaultPrevented).toBe(true);
    const para = editor.getJSON().content?.[0];
    expect(para?.content?.[0]).toMatchObject({
      text: URL_TEXT,
      marks: [{ type: "link", attrs: { href: URL_TEXT } }],
    });
  });

  it("in the middle of a line is an ordinary paste (no choice)", () => {
    const editor = makeEditor({
      filesEnabled: false,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "see " }] }],
      },
    });
    editor.commands.focus("end");
    paste(editor, transfer({ "text/plain": URL_TEXT }));
    // The existing rules and autolink own this case; it is still one paragraph holding the text.
    expect(editor.getText()).toContain(URL_TEXT);
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("Bookmark card replaces the line with a card holding the stored preview", async () => {
    const editor = makeEditor({ filesEnabled: false });
    paste(editor, transfer({ "text/plain": URL_TEXT }));
    mocks.fetchLinkPreview.mockResolvedValue({
      ok: true,
      data: {
        preview: {
          url: URL_TEXT,
          status: "OK",
          title: "An Article",
          description: "About it",
          siteName: "Example",
          favicon: null,
          fetchedAt: "2026-10-08T10:00:00.000Z",
        },
      },
    });
    const to = 1 + URL_TEXT.length;
    await applyPasteChoice({ view: editor.view, from: 1, to, url: URL_TEXT }, "card");
    const card = editor.getJSON().content?.[0];
    expect(card?.type).toBe("bookmark");
    expect(card?.attrs).toMatchObject({ url: URL_TEXT, title: "An Article", siteName: "Example" });
    expect(types(editor).at(-1)).toBe("paragraph");
  });

  it("Bookmark card leaves the link when the preview can't be loaded", async () => {
    const editor = makeEditor({ filesEnabled: false });
    paste(editor, transfer({ "text/plain": URL_TEXT }));
    mocks.fetchLinkPreview.mockResolvedValue({
      ok: true,
      data: { preview: { url: URL_TEXT, status: "BLOCKED" } },
    });
    await applyPasteChoice(
      { view: editor.view, from: 1, to: 1 + URL_TEXT.length, url: URL_TEXT },
      "card",
    );
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("Link with page title swaps the text for the title, keeping the address", async () => {
    const editor = makeEditor({ filesEnabled: false });
    paste(editor, transfer({ "text/plain": URL_TEXT }));
    mocks.fetchLinkPreview.mockResolvedValue({
      ok: true,
      data: { preview: { url: URL_TEXT, status: "OK", title: "An Article" } },
    });
    await applyPasteChoice(
      { view: editor.view, from: 1, to: 1 + URL_TEXT.length, url: URL_TEXT },
      "title",
    );
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
      text: "An Article",
      marks: [{ type: "link", attrs: { href: URL_TEXT } }],
    });
  });

  it("changes nothing when the line was edited while the preview loaded", async () => {
    const editor = makeEditor({ filesEnabled: false });
    paste(editor, transfer({ "text/plain": URL_TEXT }));
    editor.commands.insertContentAt(1, "x");
    mocks.fetchLinkPreview.mockResolvedValue({
      ok: true,
      data: { preview: { url: URL_TEXT, status: "OK", title: "An Article" } },
    });
    await applyPasteChoice(
      { view: editor.view, from: 1, to: 1 + URL_TEXT.length, url: URL_TEXT },
      "title",
    );
    expect(editor.getText()).toBe(`x${URL_TEXT}`);
  });
});

describe("dropping files", () => {
  function drop(editor: Editor, files: File[]) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer({}, files) });
    Object.defineProperty(event, "clientX", { value: 0 });
    Object.defineProperty(event, "clientY", { value: 0 });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  it("uploads a dropped picture and inserts its block", async () => {
    const editor = makeEditor({ filesEnabled: true });
    const event = drop(editor, [png()]);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(types(editor)).toContain("image"));
    expect(mocks.startUpload).toHaveBeenCalledTimes(1);
  });

  it("a dropped document becomes a file block", async () => {
    const editor = makeEditor({ filesEnabled: true });
    drop(editor, [new File(["%PDF-1.4"], "plan.pdf", { type: "application/pdf" })]);
    await vi.waitFor(() => expect(types(editor)).toContain("file"));
  });

  it("starts nothing when files are off", () => {
    const editor = makeEditor({ filesEnabled: false });
    drop(editor, [png()]);
    expect(mocks.startUpload).not.toHaveBeenCalled();
  });
});

describe("the slash items", () => {
  it("offers Image and File only when files are on, and Bookmark always", () => {
    const on = getBlocks({ ...DEFAULT_EDITOR_CONTEXT, surface: "note", filesEnabled: true }).map(
      (b) => b.id,
    );
    const off = getBlocks({ ...DEFAULT_EDITOR_CONTEXT, surface: "note", filesEnabled: false }).map(
      (b) => b.id,
    );
    expect(on).toEqual(expect.arrayContaining(["image", "file", "bookmark"]));
    expect(off).toContain("bookmark");
    expect(off).not.toContain("image");
    expect(off).not.toContain("file");
  });

  it("offers them in task descriptions too", () => {
    const ids = getBlocks({ ...DEFAULT_EDITOR_CONTEXT, surface: "task", filesEnabled: true }).map(
      (b) => b.id,
    );
    expect(ids).toEqual(expect.arrayContaining(["image", "file", "bookmark"]));
  });
});
