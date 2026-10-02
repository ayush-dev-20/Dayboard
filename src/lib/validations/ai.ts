import { z } from "zod";
import { TASK_ASSIST_MODES } from "@/lib/ai/types";
import { idSchema } from "./tasks";

// One schema per AI route. Records are always named by id: the server loads the text itself, so a
// client can never make the model "summarize" content that isn't the person's.

export const AI_TEXT_MAX = 20_000;
export const ASK_QUESTION_MAX = 1000;

const text = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(AI_TEXT_MAX, `Use ${AI_TEXT_MAX.toLocaleString("en-US")} characters or fewer.`);

export const extractTasksRequestSchema = z
  .strictObject({ text: text.optional(), inboxItemId: idSchema.optional() })
  .refine((v) => Boolean(v.text) !== Boolean(v.inboxItemId), {
    message: "Send either text or an inbox item.",
  });

export const subtasksRequestSchema = z.strictObject({ taskId: idSchema });
export const noteRequestSchema = z.strictObject({ noteId: idSchema });
export const askRequestSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(2, "Ask a question.")
    .max(ASK_QUESTION_MAX, `Use ${ASK_QUESTION_MAX.toLocaleString("en-US")} characters or fewer.`),
});
export const overdueCleanupRequestSchema = z.strictObject({});
export const taskAssistRequestSchema = z.strictObject({
  taskId: idSchema,
  mode: z.enum(TASK_ASSIST_MODES),
});
export const classifyInboxRequestSchema = z.strictObject({ inboxItemId: idSchema });
