"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/notes";
import { getNote, searchNotesForLinking, searchTasksForLinking } from "@/db/queries/notes";
import { runAction, type ActionResult } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import type { NoteDTO } from "@/lib/notes/dto";
import { requireUser } from "@/lib/session";
import {
  createNoteSchema,
  linkTaskNoteSchema,
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

const archiveSchema = z.strictObject({ id: idOnlySchema.shape.id, archived: z.boolean() });

export async function archiveNote(input: unknown): Promise<ActionResult> {
  return runAction("notes.archive", async () => {
    const user = await requireUser();
    const { id, archived } = archiveSchema.parse(input);
    await mutations.archiveNote(user.id, id, archived);
    refreshNotes();
  });
}

export async function deleteNote(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("notes.delete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.deleteNote(user.id, id);
    refreshNotes();
    revalidatePath("/tasks", "layout");
    return result;
  });
}

export async function restoreNote(input: unknown): Promise<ActionResult> {
  return runAction("notes.restore", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    await mutations.restoreNote(user.id, id);
    refreshNotes();
    revalidatePath("/tasks", "layout");
  });
}

export async function permanentlyDeleteNote(input: unknown): Promise<ActionResult> {
  return runAction("notes.permanentlyDelete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    await mutations.permanentlyDeleteNote(user.id, id);
    refreshNotes();
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
