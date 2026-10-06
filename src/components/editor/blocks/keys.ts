import { Extension } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { getToggleOpen, toggleKey } from "./toggle-state";
import { moveBlock, topBlockAt } from "./commands";

// Keyboard behaviour of the structural blocks (V2 feature 01 §5). Each handler acts only in the
// block it belongs to and returns false everywhere else, so lists, tables and plain text keep the
// editor's normal keys.

type Found = { node: PMNode; pos: number; depth: number };

/** The closest ancestor of the cursor with this node type. */
function ancestor(state: EditorState, name: string): Found | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === name) {
      return { node: $from.node(depth), pos: depth === 0 ? 0 : $from.before(depth), depth };
    }
  }
  return null;
}

const isEmptyParagraph = (node: PMNode) =>
  node.type.name === "paragraph" && node.content.size === 0;

export const BlockKeys = Extension.create<{ getOwnerId: () => string | null }>({
  name: "blockKeys",
  priority: 150,
  addOptions() {
    return { getOwnerId: () => null };
  },
  addKeyboardShortcuts() {
    const { editor } = this;
    const ownerId = () => this.options.getOwnerId();

    const enter = () => {
      const { state } = editor;
      const { selection, schema } = state;
      if (!selection.empty) return false;
      const { $from } = selection;

      // A table cell holds one paragraph: Enter is a line break inside it.
      if (ancestor(state, "tableCell") || ancestor(state, "tableHeader")) {
        return editor.commands.setHardBreak();
      }

      // In a toggle's summary: what follows the cursor moves into the first block of the body
      // (open) or into a new block after the toggle (closed).
      const summary = ancestor(state, "toggleSummary");
      if (summary) {
        const toggle = ancestor(state, "toggle")!;
        const open = getToggleOpen(toggleKey(ownerId(), String(toggle.node.attrs.id ?? "")));
        const tail = $from.parent.content.cut($from.parentOffset);
        const tr = state.tr.delete($from.pos, $from.end());
        const paragraph = schema.nodes.paragraph!.create(null, tail);
        if (open) {
          const bodyStart = tr.mapping.map(toggle.pos + 1 + summary.node.nodeSize) + 1;
          const body = tr.doc.nodeAt(bodyStart - 1)!;
          const first = body.firstChild;
          if (first && isEmptyParagraph(first) && tail.size === 0) {
            tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
          } else {
            tr.insert(bodyStart, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
          }
        } else {
          const after = tr.mapping.map(toggle.pos + toggle.node.nodeSize);
          tr.insert(after, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
        }
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      }

      // Enter on an empty last paragraph inside a toggle or callout leaves it.
      const container = ancestor(state, "toggleContent") ?? ancestor(state, "callout");
      if (container && isEmptyParagraph($from.parent) && $from.depth === container.depth + 1) {
        const last = $from.index(container.depth) === container.node.childCount - 1;
        const wrapper = ancestor(state, "toggle") ?? container;
        const onlyChild = container.node.childCount === 1;
        if (last && !(container.node.type.name === "callout" && onlyChild)) {
          const paragraph = schema.nodes.paragraph!.create();
          const tr = state.tr.delete($from.before(), $from.after());
          const after = tr.mapping.map(wrapper.pos + wrapper.node.nodeSize);
          tr.insert(after, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
      }
      return false;
    };

    const backspace = () => {
      const { state } = editor;
      const { selection, schema } = state;
      if (!selection.empty) return false;
      const { $from } = selection;
      if ($from.parentOffset !== 0) return false;

      // Empty summary of an empty toggle: the toggle becomes a plain paragraph.
      const summary = ancestor(state, "toggleSummary");
      if (summary && summary.node.content.size === 0) {
        const toggle = ancestor(state, "toggle")!;
        const body = toggle.node.child(1);
        const blank =
          body.childCount === 0 || (body.childCount === 1 && isEmptyParagraph(body.child(0)));
        if (!blank) return false;
        const tr = state.tr.replaceWith(
          toggle.pos,
          toggle.pos + toggle.node.nodeSize,
          schema.nodes.paragraph!.create(),
        );
        tr.setSelection(TextSelection.create(tr.doc, toggle.pos + 1));
        editor.view.dispatch(tr);
        return true;
      }

      // An empty first paragraph in a toggle's body: remove it and go back to the summary.
      const body = ancestor(state, "toggleContent");
      if (
        body &&
        isEmptyParagraph($from.parent) &&
        $from.depth === body.depth + 1 &&
        $from.index(body.depth) === 0
      ) {
        const tr = state.tr.delete($from.before(), $from.after());
        tr.setSelection(Selection.near(tr.doc.resolve(body.pos), -1));
        editor.view.dispatch(tr);
        return true;
      }
      return false;
    };

    // Tab moves a top-level block into the toggle above it; Shift+Tab moves it (and the blocks
    // after it) out of the toggle it is in. Lists and tables use Tab themselves, so this only
    // acts on a plain top-level block.
    const tab = (direction: 1 | -1) => () => {
      const { state } = editor;
      const { $from } = state.selection;
      if (!$from.parent.isTextblock || $from.depth < 1) return false;
      const parent = $from.node($from.depth - 1);
      if (!["doc", "toggleContent"].includes(parent.type.name)) return false;
      const block = topBlockAt(state.doc, $from.pos);
      if (!block) return false;

      if (direction === 1) {
        const before = state.doc.resolve(block.pos).nodeBefore;
        if (!before || before.type.name !== "toggle") return false;
        const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize);
        const insertAt = block.pos - 2; // the end of the toggle's body
        tr.insert(insertAt, block.node);
        tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1)));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      }

      if (parent.type.name !== "toggleContent") return false;
      const toggle = ancestor(state, "toggle")!;
      const moved: PMNode[] = [];
      for (let i = block.index; i < parent.childCount; i += 1) moved.push(parent.child(i));
      const size = moved.reduce((sum, node) => sum + node.nodeSize, 0);
      const tr = state.tr.delete(block.pos, block.pos + size);
      const after = tr.mapping.map(toggle.pos + toggle.node.nodeSize);
      tr.insert(after, Fragment.from(moved));
      tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    };

    return {
      Enter: enter,
      Backspace: backspace,
      Tab: tab(1),
      "Shift-Tab": tab(-1),
      "Alt-ArrowUp": () => moveBlock(editor, -1),
      "Alt-ArrowDown": () => moveBlock(editor, 1),
    };
  },
});
