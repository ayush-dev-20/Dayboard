import type { TiptapNode } from "../types";

// How a note link and a sub-note block leave Dayboard (V2 feature 07 §4): as an ordinary link to
// the note's address with its title, so any other tool shows something that works. Pure; the
// caller says what the address starts with and what each note is called.

export type NoteRefReader = {
  /** `https://app.example.com` (no trailing slash). */
  origin: string;
  /** What the note is called right now. */
  label(noteId: string): string;
};

function linked(noteId: string, reader: NoteRefReader): TiptapNode {
  return {
    type: "text",
    text: reader.label(noteId) || "Note",
    marks: [{ type: "link", attrs: { href: `${reader.origin}/notes/${noteId}` } }],
  };
}

/** The same nodes with every note link and sub-note block written as a link to its note. */
export function linkNoteRefs(nodes: TiptapNode[], reader: NoteRefReader): TiptapNode[] {
  return nodes.map((node) => {
    const id = typeof node.attrs?.noteId === "string" ? node.attrs.noteId : null;
    if (node.type === "noteLink" && id) return linked(id, reader);
    if (node.type === "subNote" && id) return { type: "paragraph", content: [linked(id, reader)] };
    return node.content ? { ...node, content: linkNoteRefs(node.content, reader) } : node;
  });
}
