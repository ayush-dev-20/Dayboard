"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/notes";
import {
  countBacklinks,
  getBacklinks,
  getChildren,
  getNoteMeta,
  getNoteTree,
  getOutline,
  searchNotesForNoteLink,
  type NotePickerHit,
} from "@/db/queries/note-tree";
import { getNote, searchNotesForLinking, searchTasksForLinking } from "@/db/queries/notes";
import { runAction, type ActionResult } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import type { BacklinkDTO, NoteChildDTO, NoteDTO, NoteTreeRow } from "@/lib/notes/dto";
import type { NoteMeta } from "@/lib/notes/links";
import { requireUser } from "@/lib/session";
import {
  createLinkedNoteForTaskSchema,
  createNoteSchema,
  createSubNoteSchema,
  findNotesForLinkSchema,
  linkTaskNoteSchema,
  moveNoteSchema,
  noteIdsSchema,
  saveNoteContentSchema,
  saveNoteTitleSchema,
  updateNoteMetaSchema,
} from "@/lib/validations/notes";
import { idOnlySchema, reorderSchema } from "@/lib/validations/tasks";
import { z } from "zod";

function refreshNotes() {
  revalidatePath("/notes", "layout");
  revalidatePath("/projects", "layout");
}

/**
 * Changes to where notes sit also change the sidebar tree, which the app layout loads, so they
 * refresh the whole layout. Creating a note while someone types does not (see `createNote`): the
 * editor keeps running and tells the tree about it itself.
 */
function refreshTree() {
  refreshNotes();
  revalidatePath("/", "layout");
}

export async function createNote(
  input: unknown,
): Promise<ActionResult<{ id: string; version: number }>> {
  return runAction("notes.create", async () => {
    const user = await requireUser();
    // No revalidation: the editor keeps running while the address bar changes to the new note, and a
    // refresh here would reset it. The lists are read fresh each time they are opened.
    return mutations.createNote(user.id, createNoteSchema.parse(input));
  });
}

/**
 * Autosaved while typing, so it doesn't refresh the page. A save based on an old version isn't an
 * error: it comes back as `outcome: "conflict"` with the latest version, and the editor asks the
 * person what to do. Nothing is overwritten.
 */
export async function saveNoteContent(input: unknown): Promise<ActionResult<mutations.SaveResult>> {
  return runAction("notes.saveContent", async () => {
    const user = await requireUser();
    return mutations.saveNoteContent(user.id, saveNoteContentSchema.parse(input));
  });
}

export async function saveNoteTitle(input: unknown): Promise<ActionResult<mutations.SaveResult>> {
  return runAction("notes.saveTitle", async () => {
    const user = await requireUser();
    return mutations.saveNoteTitle(user.id, saveNoteTitleSchema.parse(input));
  });
}

/** Emoji. A note's project is set with `assignToProject`. Doesn't touch `version`. */
export async function updateNoteMeta(input: unknown): Promise<ActionResult> {
  return runAction("notes.updateMeta", async () => {
    const user = await requireUser();
    const { id, emoji } = updateNoteMetaSchema.parse(input);
    if (emoji !== undefined) await mutations.updateNoteEmoji(user.id, id, emoji);
    refreshNotes();
  });
}

const archiveSchema = z.strictObject({
  id: idOnlySchema.shape.id,
  archived: z.boolean(),
  /** Unarchiving a sub-note whose parent is still archived: bring it back as a top-level note. */
  asTopLevel: z.boolean().optional(),
});

/** Archives a note with its sub-notes, or unarchives the set that went with it. */
export async function archiveNote(
  input: unknown,
): Promise<ActionResult<{ affected: number; subNotes: number }>> {
  return runAction("notes.archive", async () => {
    const user = await requireUser();
    const { id, archived, asTopLevel } = archiveSchema.parse(input);
    const result = await mutations.archiveNote(user.id, id, archived, { asTopLevel });
    refreshTree();
    return result;
  });
}

/** Moves a note and its sub-notes to Trash. `subNotes` says how many went with it. */
export async function deleteNote(
  input: unknown,
): Promise<ActionResult<{ deletedAt: string; subNotes: number }>> {
  return runAction("notes.delete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.deleteNote(user.id, id);
    refreshTree();
    revalidatePath("/tasks", "layout");
    return result;
  });
}

/**
 * Brings back a note and exactly the sub-notes that went with it. A sub-note whose parent is still
 * in Trash comes back as a `CONFLICT` with `fieldErrors.parent === "top-level"`: ask the person,
 * then call `restoreNoteAsTopLevel`.
 */
export async function restoreNote(
  input: unknown,
): Promise<ActionResult<{ restored: number; subNotes: number }>> {
  return runAction("notes.restore", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.restoreNote(user.id, id);
    refreshTree();
    revalidatePath("/tasks", "layout");
    return result;
  });
}

export async function restoreNoteAsTopLevel(
  input: unknown,
): Promise<ActionResult<{ restored: number; subNotes: number }>> {
  return runAction("notes.restoreTopLevel", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.restoreNoteAsTopLevel(user.id, id);
    refreshTree();
    revalidatePath("/tasks", "layout");
    return result;
  });
}

export async function permanentlyDeleteNote(
  input: unknown,
): Promise<ActionResult<{ removed: number; subNotes: number }>> {
  return runAction("notes.permanentlyDelete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.permanentlyDeleteNote(user.id, id);
    refreshTree();
    return result;
  });
}

/**
 * A new note under another one, first among its siblings, in the parent's project. Saved at once.
 * It does not refresh the page: the editor that asked for it keeps running and tells the tree.
 */
export async function createSubNote(input: unknown): Promise<
  ActionResult<{
    id: string;
    version: number;
    depth: number;
    projectId: string | null;
    sortOrder: number;
  }>
> {
  return runAction("notes.createSub", async () => {
    const user = await requireUser();
    return mutations.createSubNote(user.id, createSubNoteSchema.parse(input));
  });
}

/** Moves a note (and everything under it) to a new parent and place. */
export async function moveNote(
  input: unknown,
): Promise<ActionResult<{ depth: number; sortOrder: number; parentId: string | null }>> {
  return runAction("notes.move", async () => {
    const user = await requireUser();
    const result = await mutations.moveNote(user.id, moveNoteSchema.parse(input));
    refreshTree();
    return result;
  });
}

/**
 * "New linked note" from a task description: makes the note, links the task to it, and returns what
 * the editor needs to put a link to it in the text. Does not refresh: the description is open.
 */
export async function createLinkedNoteForTask(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string; emoji: string | null }>> {
  return runAction("notes.createLinkedForTask", async () => {
    const user = await requireUser();
    const { taskId, title } = createLinkedNoteForTaskSchema.parse(input);
    const created = await mutations.createNote(user.id, { title: title ?? "", linkTaskId: taskId });
    return { id: created.id, title: title ?? "", emoji: null };
  });
}

/** Titles, emoji and state (ok, archived, in Trash, gone) for the links and blocks on a page. */
export async function getNoteMetas(input: unknown): Promise<ActionResult<NoteMeta[]>> {
  return runAction("notes.meta", async () => {
    const user = await requireUser();
    const { ids } = noteIdsSchema.parse(input);
    return getNoteMeta(user.id, ids);
  });
}

/** The note picker behind `@` and `[[`. */
export async function findNotesForLink(input: unknown): Promise<ActionResult<NotePickerHit[]>> {
  return runAction("notes.findForLink", async () => {
    const user = await requireUser();
    const { query, excludeId } = findNotesForLinkSchema.parse(input);
    return searchNotesForNoteLink(user.id, query, excludeId);
  });
}

/** "Linked from": the notes and tasks that link to this note. */
export async function loadBacklinks(input: unknown): Promise<ActionResult<BacklinkDTO[]>> {
  return runAction("notes.backlinks", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    return getBacklinks(user.id, id);
  });
}

export async function loadBacklinkCount(input: unknown): Promise<ActionResult<number>> {
  return runAction("notes.backlinkCount", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    return countBacklinks(user.id, id);
  });
}

/** Every live note's place in the tree, for the Move-to picker. */
export async function loadNoteOutline(): Promise<ActionResult<NoteTreeRow[]>> {
  return runAction("notes.outline", async () => {
    const user = await requireUser();
    return getOutline(user.id);
  });
}

export async function linkTaskNote(input: unknown): Promise<ActionResult> {
  return runAction("notes.link", async () => {
    const user = await requireUser();
    const { taskId, noteId } = linkTaskNoteSchema.parse(input);
    await mutations.linkTaskNote(user.id, taskId, noteId);
    revalidatePath("/tasks", "layout");
    revalidatePath("/notes", "layout");
  });
}

export async function unlinkTaskNote(input: unknown): Promise<ActionResult> {
  return runAction("notes.unlink", async () => {
    const user = await requireUser();
    const { taskId, noteId } = linkTaskNoteSchema.parse(input);
    await mutations.unlinkTaskNote(user.id, taskId, noteId);
    revalidatePath("/tasks", "layout");
    revalidatePath("/notes", "layout");
  });
}

const searchSchema = z.strictObject({ query: z.string().max(100) });

export async function findNotesToLink(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string; emoji: string | null }[]>> {
  return runAction("notes.findToLink", async () => {
    const user = await requireUser();
    const { query } = searchSchema.parse(input);
    return searchNotesForLinking(user.id, query);
  });
}

export async function findTasksToLink(
  input: unknown,
): Promise<
  ActionResult<{ id: string; title: string; emoji: string | null; dueDate: string | null }[]>
> {
  return runAction("notes.findTasksToLink", async () => {
    const user = await requireUser();
    const { query } = searchSchema.parse(input);
    return searchTasksForLinking(user.id, query);
  });
}

/** The latest saved copy of a note, for "Load latest" after a conflict. */
export async function loadNote(input: unknown): Promise<ActionResult<NoteDTO>> {
  return runAction("notes.load", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const note = await getNote(user.id, id);
    if (!note) throw new AppError("NOT_FOUND");
    return note;
  });
}

/** Manual order on a board. Nothing refreshes: the card is already where it was dropped. */
export async function reorderNote(input: unknown): Promise<ActionResult<{ sortOrder: number }>> {
  return runAction("notes.reorder", async () => {
    const user = await requireUser();
    return mutations.reorderNote(user.id, reorderSchema.parse(input));
  });
}

/** The sidebar tree again, after notes moved, were archived, trashed or restored (here or in another tab). */
export async function loadNoteTree(): Promise<
  ActionResult<{ rows: NoteTreeRow[]; rootTotal: number }>
> {
  return runAction("notes.tree", async () => {
    const user = await requireUser();
    return getNoteTree(user.id);
  });
}

/** A note's sub-notes, for the "Sub-notes" list after a change elsewhere. */
export async function loadNoteChildren(input: unknown): Promise<ActionResult<NoteChildDTO[]>> {
  return runAction("notes.children", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    return getChildren(user.id, id);
  });
}
