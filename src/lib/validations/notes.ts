import { z } from "zod";
import { richTextSchema } from "@/lib/editor/schema";
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
  contentJson: richTextSchema.optional(),
  /** "New linked note" from a task: the new note is linked to this task in the same step. */
  linkTaskId: idSchema.nullish(),
});

export const saveNoteContentSchema = z.strictObject({
  id: idSchema,
  contentJson: richTextSchema,
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

export const linkTaskNoteSchema = z.strictObject({ taskId: idSchema, noteId: idSchema });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
