import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  DEFAULT_CALLOUT_EMOJI,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type CalloutTone,
} from "@/lib/editor/limits";

// Block-level operations shared by the slash menu, the block handle and the keyboard shortcuts
// (V2 feature 01 §4, §5). "A block" is a direct child of the document or of a toggle's content.

export type TopBlock = { node: PMNode; pos: number; index: number; parent: PMNode };

const BLOCK_PARENTS = new Set(["doc", "toggleContent"]);

/** The block that holds `pos`: the closest ancestor whose parent is the document or a toggle body. */
export function topBlockAt(doc: PMNode, pos: number): TopBlock | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const parent = $pos.node(depth - 1);
    if (BLOCK_PARENTS.has(parent.type.name)) {
      return {
        node: $pos.node(depth),
        pos: $pos.before(depth),
        index: $pos.index(depth - 1),
        parent,
      };
    }
  }
  // A position directly between blocks (a node selection at the top level).
  const after = $pos.nodeAfter;
  if (after && BLOCK_PARENTS.has($pos.parent.type.name)) {
    return { node: after, pos: $pos.pos, index: $pos.index(), parent: $pos.parent };
  }
  return null;
}

export const topBlockAtSelection = (state: EditorState) =>
  topBlockAt(state.doc, state.selection.from);

/** The direct child blocks of the document, with their positions (for the block handle). */
export function topLevelBlocks(doc: PMNode): TopBlock[] {
  const out: TopBlock[] = [];
  doc.forEach((node, offset, index) => out.push({ node, pos: offset, index, parent: doc }));
  return out;
}

function select(tr: ReturnType<EditorState["tr"]["setMeta"]>, pos: number) {
  return tr.setSelection(Selection.near(tr.doc.resolve(pos)));
}

/** Moves a block up (-1) or down (1) among its siblings, keeping the cursor in it. */
export function moveBlock(editor: Editor, direction: -1 | 1, pos?: number): boolean {
  const { state } = editor;
  const block = pos === undefined ? topBlockAtSelection(state) : topBlockAt(state.doc, pos + 1);
  if (!block) return false;
  const siblingIndex = block.index + direction;
  if (siblingIndex < 0 || siblingIndex >= block.parent.childCount) return false;

  const sibling = block.parent.child(siblingIndex);
  const first = direction === -1 ? sibling : block.node;
  const second = direction === -1 ? block.node : sibling;
  const from = direction === -1 ? block.pos - sibling.nodeSize : block.pos;
  const to = from + first.nodeSize + second.nodeSize;
  const newPos = direction === -1 ? from : from + sibling.nodeSize;
  const offset = state.selection.from - block.pos;

  const tr = state.tr.replaceWith(from, to, Fragment.from([second, first]));
  const inside = Math.min(newPos + offset, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(inside), direction === -1 ? -1 : 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateBlock(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const after = pos + node.nodeSize;
  const tr = state.tr.insert(after, node.copy(node.content));
  editor.view.dispatch(select(tr, after + 1).scrollIntoView());
  return true;
}

export function deleteBlock(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = state.tr;
  const only = state.doc.childCount === 1 && state.doc.firstChild === node;
  if (only) tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph!.create());
  else tr.delete(pos, pos + node.nodeSize);
  editor.view.dispatch(select(tr, Math.min(pos, tr.doc.content.size)).scrollIntoView());
  return true;
}

// ---- Building and inserting the structural blocks ------------------------------------------

const cell = (type: "tableCell" | "tableHeader") => ({
  type,
  content: [{ type: "paragraph" }],
});

export function tableJSON(rows = 3, columns = 3) {
  return {
    type: "table",
    content: Array.from({ length: Math.min(rows, TABLE_MAX_ROWS) }, (_, r) => ({
      type: "tableRow",
      content: Array.from({ length: Math.min(columns, TABLE_MAX_COLUMNS) }, () =>
        cell(r === 0 ? "tableHeader" : "tableCell"),
      ),
    })),
  };
}

export const calloutJSON = (tone: CalloutTone = "neutral") => ({
  type: "callout",
  attrs: { emoji: DEFAULT_CALLOUT_EMOJI, tone },
  content: [{ type: "paragraph" }],
});

export const toggleJSON = (level: 0 | 1 | 2 | 3 = 0) => ({
  type: "toggle",
  content: [
    { type: "toggleSummary", attrs: { level } },
    { type: "toggleContent", content: [{ type: "paragraph" }] },
  ],
});

/**
 * Puts a block into the document: in place of the empty paragraph the cursor is in, otherwise
 * after the block the cursor is in. The cursor ends inside the new block.
 */
export function insertBlock(editor: Editor, json: Record<string, unknown>): boolean {
  return insertBlockInView(editor.view, json);
}

/** The same, for code that has the view and not the editor (paste rules, drops). */
export function insertBlockInView(
  view: EditorView,
  json: Record<string, unknown>,
  options: { trailingParagraph?: boolean } = {},
): boolean {
  const { state } = view;
  const top = topBlockAtSelection(state);
  if (!top) return false;
  const node = state.schema.nodeFromJSON(json);
  const replace =
    top.node.type.name === "paragraph" &&
    top.node.content.size === 0 &&
    BLOCK_PARENTS.has(top.parent.type.name);
  const from = top.pos;
  const to = top.pos + top.node.nodeSize;
  const tr = replace ? state.tr.replaceWith(from, to, node) : state.tr.insert(to, node);
  const start = replace ? from : to;
  // A picture or file at the very end would leave nowhere to type below it.
  const after = start + node.nodeSize;
  if (options.trailingParagraph && after >= tr.doc.resolve(after).end()) {
    tr.insert(after, state.schema.nodes.paragraph!.create());
  }
  tr.setSelection(
    node.isAtom ? NodeSelection.create(tr.doc, start) : Selection.near(tr.doc.resolve(start + 1)),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** A block that points at a note (a sub-note), after the block the cursor is in. */
export function insertSubNoteBlock(editor: Editor, noteId: string): boolean {
  if (editor.isDestroyed) return false;
  return insertBlock(editor, { type: "subNote", attrs: { noteId } });
}

/** An inline link to a note at the cursor, followed by a space so typing carries on. */
export function insertNoteLink(editor: Editor, noteId: string): boolean {
  if (editor.isDestroyed) return false;
  return editor
    .chain()
    .focus()
    .insertContent([
      { type: "noteLink", attrs: { noteId } },
      { type: "text", text: " " },
    ])
    .run();
}

// ---- Turn into -------------------------------------------------------------------------------

export type TurnIntoKind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code"
  | "callout"
  | "toggle"
  | "toggle-h1"
  | "toggle-h2"
  | "toggle-h3";

const TEXT_LIKE = new Set(["paragraph", "heading"]);

/** Which conversions make sense for a block (the menu offers only these). */
export function turnIntoOptions(block: PMNode): TurnIntoKind[] {
  const name = block.type.name;
  const base: TurnIntoKind[] = [
    "text",
    "h1",
    "h2",
    "h3",
    "bullet",
    "ordered",
    "task",
    "quote",
    "code",
  ];
  if (name === "toggle") return ["text", "h1", "h2", "h3", "toggle-h1", "toggle-h2", "toggle-h3"];
  if (name === "callout") return ["text"];
  if (name === "table" || name === "tableOfContents" || name === "horizontalRule") return [];
  const out = [...base];
  if (TEXT_LIKE.has(name) || name.endsWith("List")) out.push("callout");
  if (TEXT_LIKE.has(name)) out.push("toggle", "toggle-h1", "toggle-h2", "toggle-h3");
  return out;
}

function toggleFrom(editor: Editor, block: TopBlock, level: 0 | 1 | 2 | 3) {
  const { state } = editor;
  const toggle = state.schema.nodes.toggle!.create(null, [
    state.schema.nodes.toggleSummary!.create({ level }, block.node.content),
    state.schema.nodes.toggleContent!.create(null, [state.schema.nodes.paragraph!.create()]),
  ]);
  const tr = state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, toggle);
  editor.view.dispatch(select(tr, block.pos + 2));
}

/** Unwraps a toggle or callout into plain blocks: the summary becomes a paragraph or heading. */
function unwrap(editor: Editor, block: TopBlock, headingLevel?: 1 | 2 | 3) {
  const { state } = editor;
  const { paragraph, heading } = state.schema.nodes;
  const parts: PMNode[] = [];
  if (block.node.type.name === "toggle") {
    const summary = block.node.child(0);
    const level = headingLevel ?? ((Number(summary.attrs.level) || 0) as 0 | 1 | 2 | 3);
    parts.push(
      level > 0
        ? heading!.create({ level }, summary.content)
        : paragraph!.create(null, summary.content),
    );
    block.node.child(1).forEach((child) => parts.push(child));
  } else {
    block.node.forEach((child) => parts.push(child));
  }
  const tr = state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, Fragment.from(parts));
  editor.view.dispatch(select(tr, block.pos + 1));
}

/**
 * Converts the block at `pos` (a top-level block position) to another kind. List and quote kinds
 * use the editor's own commands; wrappers are built here.
 */
export function turnInto(editor: Editor, pos: number, kind: TurnIntoKind): boolean {
  const { state } = editor;
  const block = topBlockAt(state.doc, pos + 1);
  if (!block) return false;
  const name = block.node.type.name;

  if (name === "toggle") {
    if (kind === "text") return (unwrap(editor, block), true);
    if (kind === "h1" || kind === "h2" || kind === "h3") {
      return (unwrap(editor, block, Number(kind[1]) as 1 | 2 | 3), true);
    }
    if (kind.startsWith("toggle-h")) {
      const level = Number(kind.slice(-1)) as 1 | 2 | 3;
      const summary = block.node.child(0);
      const tr = state.tr.setNodeMarkup(block.pos + 1, undefined, { ...summary.attrs, level });
      return (editor.view.dispatch(tr), true);
    }
    return false;
  }
  if (name === "callout") return kind === "text" ? (unwrap(editor, block), true) : false;

  // The editor's commands act on the cursor, so put it in the block unless it is already there.
  const end = block.pos + block.node.nodeSize;
  if (state.selection.from < block.pos || state.selection.to > end) {
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(block.pos + 1))),
    );
  }
  const chain = () => editor.chain().focus();

  switch (kind) {
    case "text":
      return chain().clearNodes().run();
    case "h1":
    case "h2":
    case "h3":
      return chain()
        .clearNodes()
        .setHeading({ level: Number(kind[1]) as 1 | 2 | 3 })
        .run();
    case "bullet":
      return editor.isActive("bulletList") ? true : chain().clearNodes().toggleBulletList().run();
    case "ordered":
      return editor.isActive("orderedList") ? true : chain().clearNodes().toggleOrderedList().run();
    case "task":
      return editor.isActive("taskList") ? true : chain().clearNodes().toggleTaskList().run();
    case "quote":
      return editor.isActive("blockquote") ? true : chain().clearNodes().setBlockquote().run();
    case "code":
      return chain().clearNodes().setCodeBlock().run();
    case "callout": {
      const current = topBlockAt(editor.state.doc, block.pos + 1)!;
      const node = TEXT_LIKE.has(current.node.type.name)
        ? editor.state.schema.nodes.paragraph!.create(null, current.node.content)
        : current.node;
      const callout = editor.state.schema.nodes.callout!.create(
        { emoji: DEFAULT_CALLOUT_EMOJI, tone: "neutral" },
        [node],
      );
      const tr = editor.state.tr.replaceWith(
        current.pos,
        current.pos + current.node.nodeSize,
        callout,
      );
      return (editor.view.dispatch(select(tr, current.pos + 2)), true);
    }
    case "toggle":
    case "toggle-h1":
    case "toggle-h2":
    case "toggle-h3": {
      const level = (kind === "toggle" ? 0 : Number(kind.slice(-1))) as 0 | 1 | 2 | 3;
      const current = topBlockAt(editor.state.doc, block.pos + 1)!;
      return (toggleFrom(editor, current, level), true);
    }
  }
}

/**
 * Starts dragging the block at `pos` from its handle. ProseMirror finishes the move on drop, so
 * the block is selected and registered as the thing being dragged.
 */
export function startBlockDrag(editor: Editor, pos: number, event: DragEvent): void {
  const selection = NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  editor.view.dragging = { slice: selection.content(), move: true };
  const dom = editor.view.nodeDOM(pos);
  if (event.dataTransfer) {
    if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
    event.dataTransfer.effectAllowed = "move";
  }
}
