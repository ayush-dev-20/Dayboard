import { z } from "zod";
import { MAX_TITLE } from "@/lib/canvas/types";
import { emojiSchema, idSchema } from "./tasks";

// Inputs of the canvas actions (V3 feature 01 §6). Strict: unknown keys, such as a client-sent `userId` or a client's
// own search text, are refused. The scene is checked again by `sanitizeScene` on the server.

export const canvasTitleSchema = z
  .string()
  .max(MAX_TITLE, `Use ${MAX_TITLE} characters or fewer.`)
  .transform((v) => v.replace(/\s+/g, " ").trim());

const versionSchema = z.number().int().min(1);

/**
 * An AI diagram being applied (V3 feature 01 §6): the proposal's id, which can be used once, and the counts the audit
 * row says. Numbers only: the row never holds a word the client could choose.
 */
export const proposalSchema = z.strictObject({
  id: z.string().min(8).max(64),
  sections: z.number().int().min(0).max(13),
  boxes: z.number().int().min(1).max(60),
  connections: z.number().int().min(0).max(120),
});
export type ProposalInput = z.infer<typeof proposalSchema>;

/** A scene is any object here; `sanitizeScene` decides what is kept. */
const sceneInput = z.unknown();

export const createCanvasSchema = z.strictObject({
  kind: z.enum(["DRAWING"]).optional(),
  title: canvasTitleSchema.optional(),
  emoji: emojiSchema.nullish(),
  projectId: idSchema.nullish(),
  scene: sceneInput.optional(),
  /** Set when the scene came from an AI diagram: applies once and writes one audit row, from these counts only. */
  proposal: proposalSchema.optional(),
});

export const saveCanvasSchema = z.strictObject({
  id: idSchema,
  version: versionSchema,
  scene: sceneInput.optional(),
  title: canvasTitleSchema.optional(),
  /** "Add to this canvas": the diagram that was put on it. Applies once, with an audit row of counts. */
  proposal: proposalSchema.optional(),
});

export const updateCanvasMetaSchema = z.strictObject({
  id: idSchema,
  title: canvasTitleSchema.optional(),
  emoji: emojiSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
});

export const canvasIdSchema = z.strictObject({ id: idSchema });

export const archiveCanvasSchema = z.strictObject({ id: idSchema, archived: z.boolean() });

export const linkTaskCanvasSchema = z.strictObject({ taskId: idSchema, canvasId: idSchema });

export const addCardTargetSchema = z.strictObject({
  type: z.enum(["note", "task", "project"]),
  id: idSchema,
  /** For a task: link it to this canvas in the same step. */
  canvasId: idSchema.optional(),
});

export const findLinkSchema = z.strictObject({ query: z.string().max(100) });
