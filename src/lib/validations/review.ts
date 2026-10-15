import { z } from "zod";
import { dateSchema, idSchema } from "./tasks";

// Inputs of the weekly review (V2 feature 15 §7). Strict: a client-sent `userId` or `status` is refused.

export const generateReviewSchema = z.strictObject({
  weekStart: dateSchema.optional(),
});

export const weekParamSchema = z.strictObject({ weekStart: dateSchema });

export const reviewIdSchema = z.strictObject({ id: idSchema });

const applyAction = z.enum(["KEEP", "RESCHEDULE", "ARCHIVE", "CANCEL"]);

/** The rows the person left ticked. DROP in the suggestions becomes Archive or Cancel, as they pick. */
export const applyCarrySchema = z.strictObject({
  reviewId: idSchema,
  rows: z
    .array(
      z.strictObject({
        taskId: idSchema,
        action: applyAction,
        dueDate: dateSchema.nullish(),
      }),
    )
    .max(20),
});

export const undoCarrySchema = z.strictObject({
  reviewId: idSchema,
  undo: z
    .array(
      z.strictObject({
        taskId: idSchema,
        dueDate: dateSchema.nullable(),
        status: z.string().min(1).max(20),
        archived: z.boolean(),
      }),
    )
    .max(20),
});
