import { Node, ReactNodeViewRenderer } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { isNoteId } from "@/lib/notes/links";
import { NoteLinkView, SubNoteView } from "./note-link-views";

// The two nodes that point at a note (V2 feature 07 §2): `noteLink` is inline, `subNote` is a block.
// Neither stores a title, emoji or address, only the note's id, so renaming, moving, archiving,
// trashing and restoring never break them. `sanitizeDoc` enforces the same shape on the server.

const noteIdAttribute = () => ({
  noteId: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const id = el.getAttribute("data-note-id");
      return isNoteId(id) ? id.toLowerCase() : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.noteId ? { "data-note-id": String(attrs.noteId) } : {},
  },
});

/**
 * Enter on a selected link or block opens it (the same as clicking), so a note link is reachable
 * from the keyboard: arrow onto it, press Enter.
 */
function openSelected(name: string) {
  return ({ editor }: { editor: import("@tiptap/react").Editor }) => {
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false;
    const dom = editor.view.nodeDOM(selection.from) as HTMLElement | null;
    const target = dom?.querySelector<HTMLElement>("a[href], button");
    if (!target) return false;
    target.click();
    return true;
  };
}

export function createNoteLink(interactive: boolean) {
  return Node.create({
    name: "noteLink",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: noteIdAttribute,
    parseHTML() {
      return [{ tag: 'a[data-type="note-link"]' }, { tag: 'span[data-type="note-link"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      const id = HTMLAttributes["data-note-id"];
      return [
        "a",
        { ...HTMLAttributes, "data-type": "note-link", ...(id ? { href: `/notes/${id}` } : {}) },
        "Note",
      ];
    },
    addKeyboardShortcuts() {
      return { Enter: openSelected(this.name) };
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(NoteLinkView) : undefined,
  });
}

export function createSubNote(interactive: boolean) {
  return Node.create({
    name: "subNote",
    group: "topBlock",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: noteIdAttribute,
    parseHTML() {
      return [{ tag: 'div[data-type="sub-note"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "sub-note" }];
    },
    addKeyboardShortcuts() {
      return { Enter: openSelected(this.name) };
    },
    addNodeView: interactive ? () => ReactNodeViewRenderer(SubNoteView) : undefined,
  });
}
