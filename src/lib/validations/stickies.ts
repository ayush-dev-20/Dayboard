import { z } from "zod";
import { COLOR_TOKENS } from "@/lib/colors";
import { COLUMN_ID, COLUMN_STATUSES } from "@/lib/canvas/board";
import { idSchema } from "./tasks";

// Inputs of the sticky-note actions (V3 feature 01 §13.3). Strict: unknown keys, such as a client-sent `userId`, `status`
// or `boardCanvasId` on an update, are refused. The text is checked again by `splitStickyText` on the server.

const columnId = z.string().regex(COLUMN_ID, "That column isn't valid.");
const tone = z.enum(COLOR_TOKENS);
const versionSchema = z.number().int().min(1);
const text = z.string().max(2_000);

export const createStickySchema = z.strictObject({
  canvasId: idSchema,
  columnId,
  text,
  tone: tone.nullish(),
});

export const updateStickySchema = z
  .strictObject({
    id: idSchema,
    text: text.optional(),
    tone: tone.nullable().optional(),
  })
  .refine((v) => v.text !== undefined || v.tone !== undefined, "Nothing to change.");

export const moveStickySchema = z.strictObject({
  id: idSchema,
  columnId,
  /** The sticky that will sit just below the moved one, or null for the end of the column. */
  beforeId: idSchema.nullable(),
});

export const stickyIdSchema = z.strictObject({ id: idSchema });

export const changeColumnStatusSchema = z.strictObject({
  canvasId: idSchema,
  version: versionSchema,
  columnId,
  status: z.enum(COLUMN_STATUSES),
});

export const deleteBoardColumnSchema = z.strictObject({
  canvasId: idSchema,
  version: versionSchema,
  columnId,
  /** The column the stickies go to, or null to move them to Trash. */
  moveTo: columnId.nullable(),
});
