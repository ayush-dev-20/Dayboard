import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { MESSAGES } from "../limits";
import type { TiptapNode } from "../types";
import { flavoursFor } from "./copy";
import { fitInner, toCalloutChildren } from "./fit";
import { blocksToInline, inlineText } from "./inline";
import { fitToBudget, planPaste, planPlainPaste, type PasteInput } from "./paste";
import { plainParagraphs } from "./parse-text";
import {
  registerCorePasteRules,
  runPasteRules,
  type ParsedClipboard,
  type PasteContext,
} from "./rules";
import { decodeInternal, INTERNAL_MIME } from "./slice";

// The ProseMirror side of clipboard fidelity (V2 feature 02): writes the three flavours on copy and
// cut, and reads a paste in the spec's order. Everything that decides what the content is lives in
// the pure modules beside this file; this one only moves content between the clipboard and the
// editor, and fits it to where the cursor is.

registerCorePasteRules();

export type ClipboardPluginOptions = {
  getContext: () => PasteContext;
  /** A quiet message for the person ("Pasted content was shortened to fit."). */
  onNotice: (message: string) => void;
};

export const clipboardKey = new PluginKey("dayboardClipboard");

// ---- Copy and cut ----------------------------------------------------------------------------

/** Writes the three flavours for a slice onto a clipboard event's data. */
function writeSlice(data: DataTransfer, slice: Slice) {
  const content = (slice.content.toJSON() ?? []) as TiptapNode[];
  const flavours = flavoursFor(content, slice.openStart, slice.openEnd);
  data.clearData();
  data.setData("text/html", flavours.html);
  data.setData("text/plain", flavours.text);
  data.setData(INTERNAL_MIME, flavours.internal);
}

function onCopy(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { selection } = view.state;
  const data = event.clipboardData;
  if (selection.empty || !data) return false;
  writeSlice(data, selection.content());
  event.preventDefault();
  if (cut && view.editable) {
    view.dispatch(
      closeHistory(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut")),
    );
  }
  return true;
}

// ---- Reading the clipboard -------------------------------------------------------------------

function readClipboard(data: DataTransfer): PasteInput {
  let vscodeMode: string | undefined;
  try {
    const mode = (JSON.parse(data.getData("vscode-editor-data") || "{}") as { mode?: unknown })
      .mode;
    if (typeof mode === "string") vscodeMode = mode;
  } catch {
    // Not JSON: no language.
  }
  return {
    types: Array.from(data.types ?? []),
    html: data.getData("text/html"),
    text: data.getData("text/plain"),
    files: Array.from(data.files ?? []),
    internal: decodeInternal(data.getData(INTERNAL_MIME)),
    vscodeMode,
  };
}

/** Cmd/Ctrl+Shift+V. ProseMirror notes the shift key; Shift+Insert is an ordinary paste. */
function isPlainPaste(view: EditorView): boolean {
  const input = (view as unknown as { input?: { shiftKey?: boolean; lastKeyCode?: number } }).input;
  return Boolean(input?.shiftKey) && input?.lastKeyCode !== 45;
}

// ---- Fitting content to the cursor -----------------------------------------------------------

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);

/** Where only inline content fits: a table cell's paragraph, a toggle's title. */
function inlineOnlyAt($from: ResolvedPos): boolean {
  if ($from.parent.type.name === "toggleSummary") return true;
  return $from.depth >= 2 && CELL_TYPES.has($from.node($from.depth - 1).type.name);
}

/** The list item the cursor is in, with the types to build a sibling item. */
function listItemAt($from: ResolvedPos) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const parent = $from.node(depth - 1);
    if (
      (node.type.name === "listItem" || node.type.name === "taskItem") &&
      /List$/.test(parent.type.name)
    ) {
      return { item: node.type, list: parent.type };
    }
  }
  return null;
}

/**
 * The blocks as the place under the cursor can hold them: a table, toggle or callout cannot go in
 * a list item or a quote, and a callout takes only paragraphs and lists.
 */
function fitToPlace($from: ResolvedPos, blocks: TiptapNode[]): TiptapNode[] {
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "callout") return toCalloutChildren(blocks);
    if (name === "listItem" || name === "taskItem" || name === "blockquote")
      return fitInner(blocks);
  }
  return blocks;
}

/** A slice ready to insert at the selection, or null when the content cannot be built. */
function sliceFor(view: EditorView, blocks: TiptapNode[]): Slice | null {
  const { schema } = view.state;
  const $from = view.state.selection.$from;
  try {
    if (blocks.length === 0) return null;
    blocks = fitToPlace($from, blocks);

    if (inlineOnlyAt($from)) {
      const inline = blocksToInline(blocks);
      return inline.length > 0 ? new Slice(Fragment.fromJSON(schema, inline), 0, 0) : null;
    }

    // Several paragraphs pasted into a list item become several items of that list.
    const list = listItemAt($from);
    if (list && blocks.length >= 2 && blocks.every((block) => block.type === "paragraph")) {
      const items = blocks.map((block) => list.item.create(null, schema.nodeFromJSON(block)));
      return new Slice(Fragment.from(list.list.create(null, items)), 3, 3);
    }

    // One paragraph is just text: it lands in the line the cursor is on.
    if (blocks.length === 1 && blocks[0]!.type === "paragraph") {
      return new Slice(Fragment.fromJSON(schema, blocks[0]!.content ?? []), 0, 0);
    }

    const nodes = blocks.map((block) => schema.nodeFromJSON(block));
    nodes.forEach((node) => node.check());
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    return new Slice(
      Fragment.from(nodes),
      first.type.name === "paragraph" ? 1 : 0,
      last.type.name === "paragraph" ? 1 : 0,
    );
  } catch {
    return null;
  }
}

const docBytes = (doc: PMNode) => new TextEncoder().encode(JSON.stringify(doc.toJSON())).length;

/**
 * Inserts the slice as one undo step. False when the editor refused or could not place it.
 * Pasting blocks onto an empty line replaces that line (it would otherwise be left behind).
 */
function insertSlice(view: EditorView, slice: Slice): boolean {
  const before = view.state;
  const { selection } = before;
  const { $from } = selection;
  const closedBlocks =
    slice.openStart === 0 && slice.content.firstChild && !slice.content.firstChild.isInline;

  let tr = before.tr;
  if (
    selection.empty &&
    closedBlocks &&
    $from.parent.isTextblock &&
    $from.parent.content.size === 0
  ) {
    tr = tr.replaceRange($from.before(), $from.after(), slice);
  }
  if (!tr.docChanged) tr = before.tr.replaceSelection(slice);
  tr.scrollIntoView().setMeta("paste", true).setMeta("preventAutolink", true);
  if (!tr.docChanged) return false;
  // Typing just before a paste must not share its undo step: one undo takes back the paste alone.
  view.dispatch(closeHistory(tr));
  // A limit (list depth, table size) can refuse the edit; the state is then untouched.
  return view.state !== before;
}

/** Text exactly as it is, at the selection (a code block keeps its line breaks). */
function insertRawText(view: EditorView, text: string): boolean {
  const before = view.state;
  view.dispatch(
    before.tr
      .insertText(text)
      .scrollIntoView()
      .setMeta("paste", true)
      .setMeta("preventAutolink", true),
  );
  return view.state !== before;
}

function insertPlainText(view: EditorView, text: string): boolean {
  const slice = sliceFor(view, plainParagraphs(text));
  if (slice && insertSlice(view, slice)) return true;
  const before = view.state;
  view.dispatch(before.tr.insertText(text).scrollIntoView().setMeta("paste", true));
  return view.state !== before;
}

function htmlToText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

// ---- Paste -----------------------------------------------------------------------------------

function onPaste(
  view: EditorView,
  event: ClipboardEvent,
  options: ClipboardPluginOptions,
): boolean {
  const transfer = event.clipboardData;
  if (!view.editable || !transfer) return false;
  const data = readClipboard(transfer);
  const { $from } = view.state.selection;

  // Files alone are for the features that take files; the editor has nothing to do with them yet.
  if (data.files.length > 0 && !data.html && !data.text) return false;

  // 1. Plain paste: the text only, no detection.
  if (isPlainPaste(view)) {
    const text = data.text || htmlToText(data.html);
    if (!text) return false;
    event.preventDefault();
    if ($from.parent.type.spec.code) return insertRawText(view, text);
    return insertDoc(view, planPlainPaste(text).content ?? [], [], options);
  }

  // 2. Paste rules registered by features (note links, images, bookmarks) and the URL rule.
  const ctx = options.getContext();
  const parsed: ParsedClipboard = data;
  if (runPasteRules(view, parsed, ctx)) {
    event.preventDefault();
    return true;
  }

  // Inside a code block it is always the text, never structure.
  if ($from.parent.type.spec.code) {
    const text = data.text || htmlToText(data.html);
    if (!text) return false;
    event.preventDefault();
    return insertRawText(view, text);
  }

  // 3 to 5. Dayboard's own flavour, then HTML, then plain text.
  let plan: ReturnType<typeof planPaste>;
  try {
    plan = planPaste(data);
  } catch {
    return false;
  }
  if (plan.kind === "none") return false;
  event.preventDefault();

  try {
    if (plan.kind === "internal") return insertInternal(view, plan.slice, options);
    return insertDoc(view, plan.doc.content ?? [], plan.notices, options);
  } catch {
    const text = data.text || htmlToText(data.html);
    return text ? insertPlainText(view, text) : false;
  }
}

function insertDoc(
  view: EditorView,
  blocks: TiptapNode[],
  notices: string[],
  options: ClipboardPluginOptions,
): boolean {
  const fitted = fitToBudget(blocks, docBytes(view.state.doc));
  notices.forEach((message) => options.onNotice(message));
  if (fitted.shortened) options.onNotice(MESSAGES.pasteShortened);
  if (fitted.blocks.length === 0) return true;

  const slice = sliceFor(view, fitted.blocks);
  if (slice && insertSlice(view, slice)) return true;
  // The structure could not go here; keep the words.
  const text = inlineText(blocksToInline(fitted.blocks));
  return text ? insertPlainText(view, text) : false;
}

function insertInternal(
  view: EditorView,
  internal: NonNullable<PasteInput["internal"]>,
  options: ClipboardPluginOptions,
): boolean {
  const { schema } = view.state;
  const $from = view.state.selection.$from;
  const fitted = fitToBudget(internal.doc.content, docBytes(view.state.doc));
  if (fitted.shortened) options.onNotice(MESSAGES.pasteShortened);
  if (fitted.blocks.length === 0) return true;

  if (inlineOnlyAt($from)) {
    const slice = sliceFor(view, fitted.blocks);
    return slice ? insertSlice(view, slice) : false;
  }
  const openEnd = fitted.shortened ? 0 : internal.openEnd;
  const slice = Slice.fromJSON(schema, {
    content: fitted.blocks,
    openStart: internal.openStart,
    openEnd,
  });
  if (insertSlice(view, slice)) return true;
  // Could not be placed as it was copied (a limit, or a place that cannot hold it): as blocks.
  const fallback = sliceFor(view, fitted.blocks);
  return fallback ? insertSlice(view, fallback) : false;
}

export function clipboardPlugin(options: ClipboardPluginOptions): Plugin {
  return new Plugin({
    key: clipboardKey,
    props: {
      handleDOMEvents: {
        copy: (view, event) => onCopy(view, event, false),
        cut: (view, event) => onCopy(view, event, true),
        paste: (view, event) => onPaste(view, event, options),
      },
    },
  });
}
