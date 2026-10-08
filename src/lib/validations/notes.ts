import { z } from "zod";
import { noteRichTextSchema } from "@/lib/editor/schema";
import { idSchema, emojiSchema } from "./tasks";

export const NOTE_TITLE_MAX = 300;

// An empty title is allowed (the UI shows "Untitled").
export const noteTitleSchema = z
  .string()
  .max(NOTE_TITLE_MAX, `Use ${NOTE_TITLE_MAX} characters or fewer.`)
  .transform((v) => v.replace(/\s+/g, " ").trim());

const versionSchema = z.number().int().min(1);

export const createNoteSchema = z.strictObject({
  title: noteTitleSchema.optional(),
  emoji: emojiSchema.nullish(),
  projectId: idSchema.nullish(),
  contentJson: noteRichTextSchema.optional(),
  /** "New linked note" from a task: the new note is linked to this task in the same step. */
  linkTaskId: idSchema.nullish(),
});

export const saveNoteContentSchema = z.strictObject({
  id: idSchema,
  contentJson: noteRichTextSchema,
  baseVersion: versionSchema,
});

export const saveNoteTitleSchema = z.strictObject({
  id: idSchema,
  title: noteTitleSchema,
  baseVersion: versionSchema,
});

// Emoji only. A note's project is changed with `assignToProject`, the same path as tasks and todos.
export const updateNoteMetaSchema = z.strictObject({
  id: idSchema,
  emoji: emojiSchema.nullable().optional(),
});

/** A new note under another one (V2 feature 07 §3). */
export const createSubNoteSchema = z.strictObject({
  parentId: idSchema,
  title: noteTitleSchema.optional(),
  emoji: emojiSchema.nullish(),
});

/** Where a note goes: a new parent (or the top level) and a place among its new siblings. */
export const moveNoteSchema = z.strictObject({
  id: idSchema,
  parentId: idSchema.nullable(),
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});

/** "New linked note" from a task: creates the note, links the task, and returns the node to insert. */
export const createLinkedNoteForTaskSchema = z.strictObject({
  taskId: idSchema,
  title: noteTitleSchema.optional(),
});

export const noteIdsSchema = z.strictObject({ ids: z.array(idSchema).max(200) });

export const findNotesForLinkSchema = z.strictObject({
  query: z.string().max(100),
  /** The note being edited, so it is never offered to itself. */
  excludeId: idSchema.nullish(),
});

export const linkTaskNoteSchema = z.strictObject({ taskId: idSchema, noteId: idSchema });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
