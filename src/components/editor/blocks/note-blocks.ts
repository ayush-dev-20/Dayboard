import { FilePlus2, FileSymlink } from "lucide-react";
import { toast } from "sonner";
import { insertNoteLink, insertSubNoteBlock } from "./commands";
import { makeLinkedNote, makeSubNote } from "./note-create";
import { hasBlock, registerBlock } from "./registry";

// The two slash-menu items that make a note (V2 feature 07 §4): a note has "Sub-note", and a task
// description (which cannot hold a sub-note block) has "New linked note". Both go in the Links group.

export function registerNoteBlocks(): void {
  if (!hasBlock("sub-note")) {
    registerBlock({
      id: "sub-note",
      title: "Sub-note",
      keywords: ["page", "child", "nested", "new note", "inside"],
      group: "Links",
      icon: FilePlus2,
      surfaces: ["note"],
      async insert(editor, ctx) {
        const made = await makeSubNote(ctx);
        if (made && !insertSubNoteBlock(editor, made.id)) {
          // The text moved on while the note was being made; the note exists and shows under
          // "Sub-notes" at the end of this one, so nothing is lost.
          toast("Sub-note created. It is listed under Sub-notes.");
        }
      },
    });
  }
  if (!hasBlock("new-linked-note")) {
    registerBlock({
      id: "new-linked-note",
      title: "New linked note",
      keywords: ["create", "note", "link", "page"],
      group: "Links",
      icon: FileSymlink,
      surfaces: ["task"],
      available: (ctx) => ctx.ownerId !== null,
      async insert(editor, ctx) {
        const made = await makeLinkedNote(ctx);
        if (made) insertNoteLink(editor, made.id);
      },
    });
  }
}
