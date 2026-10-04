import type { Editor } from "@tiptap/react";
import { Fragment, Slice, type Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  MAX_BEFORE_CHARS,
  placeLinks,
  planReplacement,
  rangeUnchanged,
  splitParagraphs,
  STALE,
  type LinkSpan,
} from "@/lib/editor/replace-plan";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// How AI content gets into the live editor. Each function is one ProseMirror transaction, so a
// single Undo restores the document, and autosave sees an ordinary edit. None of them throws: a
// failure comes back as `{ ok: false, reason }` and the document is left as it was.

export type ApplyResult = { ok: true } | { ok: false; reason: string };

const ok: ApplyResult = { ok: true };
const fail = (reason: string): ApplyResult => ({ ok: false, reason });
const CANT_APPLY = "The note changed. Regenerate or copy the text.";

function nodes(doc: TiptapDoc): TiptapNode[] {
  return doc.content ?? [];
}

function attempt(editor: Editor, apply: () => boolean): ApplyResult {
  if (editor.isDestroyed) return fail(CANT_APPLY);
  try {
    return apply() ? ok : fail(CANT_APPLY);
  } catch (error) {
    return fail(error instanceof Error && error.message === STALE ? STALE : CANT_APPLY);
  }
}

/** After the selection, or at the cursor (a paragraph is split there if the text is in the middle). */
export function insertDocAtCursor(editor: Editor, doc: TiptapDoc): ApplyResult {
  const content = nodes(doc);
  if (content.length === 0) return fail("There is nothing to insert.");
  return attempt(editor, () =>
    editor.chain().focus().insertContentAt(editor.state.selection.to, content).run(),
  );
}

/** At the very end. A trailing empty paragraph is used up instead of leaving a gap above the text. */
export function appendDoc(editor: Editor, doc: TiptapDoc): ApplyResult {
  const content = nodes(doc);
  if (content.length === 0) return fail("There is nothing to insert.");
  return attempt(editor, () => {
    const { doc: current } = editor.state;
    const last = current.lastChild;
    const end = current.content.size;
    const from =
      last && last.type.name === "paragraph" && last.content.size === 0 && current.childCount > 1
        ? end - last.nodeSize
        : end;
    const to = end;
    return editor.chain().focus().insertContentAt({ from, to }, content).run();
  });
}

/** The whole document becomes the new content. One step, so Undo brings the old one back. */
export function replaceAll(editor: Editor, doc: TiptapDoc): ApplyResult {
  const content = nodes(doc);
  if (content.length === 0) return fail("There is nothing to insert.");
  return attempt(editor, () =>
    editor.chain().focus().setContent({ type: "doc", content }, { emitUpdate: true }).run(),
  );
}

// ---- Writing help (feature 08 §7) --------------------------------------------------------------

export type SelectionRange = { from: number; to: number };

export type SelectionInfo = SelectionRange & {
  /** The selected text, blocks separated by a blank line. */
  text: string;
  /** Up to 2,000 characters before the selection, for Continue. */
  before: string;
  /** Node type of each text block the selection touches, and any divider inside it. */
  blockTypes: string[];
  /** The selection has more than one set of marks (bold here, plain there). */
  mixedMarks: boolean;
};

type TextBlock = { from: number; to: number; type: string };

const textOf = (doc: PMNode, from: number, to: number) => doc.textBetween(from, to, "\n\n", "\n");

/** The parts of each text block that the range covers (blocks with nothing selected are skipped). */
function blocksIn(doc: PMNode, from: number, to: number): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + node.nodeSize - 1);
    if (end > start) blocks.push({ from: start, to: end, type: node.type.name });
    return false;
  });
  return blocks;
}

const markKey = (marks: readonly Mark[]) =>
  marks
    .map((m) => `${m.type.name}:${JSON.stringify(m.attrs)}`)
    .sort()
    .join("|");

/** What Writing help needs to know about the editor's current selection. */
export function readSelection(editor: Editor): SelectionInfo {
  const { doc, selection } = editor.state;
  const { from, to } = selection;
  const blockTypes = blocksIn(doc, from, to).map((b) => b.type);
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "horizontalRule") blockTypes.push("horizontalRule");
    return true;
  });

  const kinds = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) kinds.add(markKey(node.marks));
    return true;
  });

  return {
    from,
    to,
    text: from === to ? "" : textOf(doc, from, to),
    before: textOf(doc, 0, from).slice(-MAX_BEFORE_CHARS),
    blockTypes,
    mixedMarks: kinds.size > 1,
  };
}

/**
 * Follows a range through later edits. It becomes stale if anything inside it changes (typing,
 * undo, a reload of the content); edits before it only move it, and typing right at its edges
 * does not count.
 */
export function trackRange(editor: Editor, range: SelectionRange) {
  let { from, to } = range;
  let stale = false;
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    for (const map of transaction.mapping.maps) {
      map.forEach((oldStart, oldEnd) => {
        if (oldStart < to && oldEnd > from) stale = true;
      });
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
  };
  editor.on("transaction", onTransaction);
  return {
    current: () => ({ from, to, stale }),
    stop: () => editor.off("transaction", onTransaction),
  };
}

function linksIn(doc: PMNode, from: number, to: number): LinkSpan[] {
  const links: LinkSpan[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    const link = node.isText ? node.marks.find((m) => m.type.name === "link") : undefined;
    if (!node.isText || !link) return true;
    const text = node.text!.slice(Math.max(0, from - pos), Math.max(0, to - pos));
    const href = String(link.attrs.href ?? "");
    const last = links[links.length - 1];
    if (last && last.href === href) last.text += text;
    else if (text) links.push({ text, href });
    return true;
  });
  return links;
}

/** The marks of the first character at `pos`, without links (those are placed by their words). */
function firstMarks(doc: PMNode, pos: number): readonly Mark[] {
  const node = doc.nodeAt(pos);
  return node?.isText ? node.marks.filter((m) => m.type.name !== "link") : [];
}

function inline(schema: Schema, text: string, marks: readonly Mark[], links: LinkSpan[]): PMNode[] {
  const linkType = schema.marks.link;
  return placeLinks(text, links).map((piece) =>
    schema.text(
      piece.text,
      piece.href && linkType ? [...marks, linkType.create({ href: piece.href })] : marks,
    ),
  );
}

/**
 * Replaces the selected text with the model's answer in one transaction, so ⌘Z restores the
 * original and its formatting. Equal block counts are replaced block by block (a list item stays a
 * list item, and the text keeps the first character's marks); otherwise the range becomes the new
 * paragraphs. Nothing outside the range is touched.
 */
export function replaceSelection(
  editor: Editor,
  range: SelectionRange,
  original: string,
  answer: string,
): ApplyResult {
  return attempt(editor, () => {
    const { doc, schema } = editor.state;
    if (
      range.to > doc.content.size ||
      !rangeUnchanged(original, textOf(doc, range.from, range.to))
    ) {
      throw new Error(STALE);
    }
    const blocks = blocksIn(doc, range.from, range.to);
    const plan = planReplacement(blocks.length, answer);
    if (blocks.length === 0 || !plan) return false;

    const tr = editor.state.tr;
    if (plan.kind === "inPlace") {
      // Last block first, so the positions of the earlier ones stay valid.
      for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const block = blocks[i]!;
        const nodes = inline(
          schema,
          plan.texts[i]!,
          firstMarks(doc, block.from),
          linksIn(doc, block.from, block.to),
        );
        tr.replaceWith(block.from, block.to, nodes);
      }
    } else {
      const marks = firstMarks(doc, range.from);
      const links = linksIn(doc, range.from, range.to);
      const paragraphs = plan.paragraphs.map((text) =>
        schema.nodes.paragraph!.create(null, inline(schema, text, marks, links)),
      );
      tr.replace(range.from, range.to, new Slice(Fragment.from(paragraphs), 1, 1));
    }
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  });
}

/** Continue: new paragraphs after the block that holds the selection or cursor, with no marks. */
export function insertBelow(editor: Editor, range: SelectionRange, answer: string): ApplyResult {
  const paragraphs = splitParagraphs(answer);
  if (paragraphs.length === 0) return fail("There is nothing to insert.");
  return attempt(editor, () => {
    const { doc, schema } = editor.state;
    if (range.to > doc.content.size) return false;
    const $to = doc.resolve(range.to);
    const pos = $to.depth >= 1 ? $to.after(1) : range.to;
    const nodes = paragraphs.map((text) => schema.nodes.paragraph!.create(null, schema.text(text)));
    editor.view.dispatch(editor.state.tr.insert(pos, nodes).scrollIntoView());
    return true;
  });
}
