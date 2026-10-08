import { toast } from "sonner";
import { createLinkedNoteForTask, createNote, createSubNote } from "@/actions/notes";
import { emitNoteEvent } from "@/components/notes/note-events";
import { primeNoteMeta } from "@/components/notes/note-meta-store";
import type { EditorContext } from "./registry";

// Making a note from inside the editor (V2 feature 07 §3, §4): a sub-note, a top-level note, or a
// note linked to a task. Each tells the sidebar tree and the link store about the new note, so a
// link to it shows its title straight away, and each answers with the note's id (or null after
// telling the person why it could not be made).

export type MadeNote = { id: string; title: string };

/** Far above any real order, so a note made here shows first until the tree is read again. */
const FIRST = -1e15;

function made(id: string, title: string): MadeNote {
  primeNoteMeta([{ id, title, emoji: null, state: "ok" }]);
  return { id, title };
}

/** A new note under the one being edited, in its project, first among its sub-notes. */
export async function makeSubNote(ctx: EditorContext, title = ""): Promise<MadeNote | null> {
  const parentId = ctx.ownerId ?? (await ctx.ensureOwner?.()) ?? null;
  if (!parentId) {
    toast.error("Couldn't make a sub-note yet. Type something first, then try again.");
    return null;
  }
  const result = await createSubNote({ parentId, title });
  if (!result.ok) {
    toast.error(result.error.message);
    return null;
  }
  emitNoteEvent({
    type: "created",
    note: {
      id: result.data.id,
      parentId,
      title,
      emoji: null,
      sortOrder: result.data.sortOrder,
      depth: result.data.depth,
    },
  });
  return made(result.data.id, title);
}

export async function makeTopLevelNote(title: string): Promise<MadeNote | null> {
  const result = await createNote({ title });
  if (!result.ok) {
    toast.error(result.error.message);
    return null;
  }
  emitNoteEvent({
    type: "created",
    note: { id: result.data.id, parentId: null, title, emoji: null, sortOrder: FIRST, depth: 1 },
  });
  return made(result.data.id, title);
}

/** A note linked to the task being edited ("New linked note"). */
export async function makeLinkedNote(ctx: EditorContext, title = ""): Promise<MadeNote | null> {
  if (!ctx.ownerId) return null;
  const result = await createLinkedNoteForTask({ taskId: ctx.ownerId, title });
  if (!result.ok) {
    toast.error(result.error.message);
    return null;
  }
  emitNoteEvent({
    type: "created",
    note: {
      id: result.data.id,
      parentId: null,
      title,
      emoji: null,
      sortOrder: FIRST,
      depth: 1,
    },
  });
  return made(result.data.id, title);
}
