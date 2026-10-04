import { z } from "zod";
import { EDIT_MODES, GENERATE_LENGTHS, TASK_ASSIST_MODES } from "@/lib/ai/types";
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

// Feature 08. Records are named by id; the one exception is the selection for writing help, which
// is the person's own live editor text (it may be unsaved), bounded and never mixed with workspace
// data.
export const GENERATE_PROMPT_MAX = 2000;
export const EDIT_TEXT_MAX = 6000;
export const EDIT_BEFORE_MAX = 2000;

export const generateContentRequestSchema = z
  .strictObject({
    target: z.enum(["note", "task", "new"]),
    targetId: idSchema.optional(),
    prompt: z
      .string()
      .trim()
      .min(1, "Describe what to write.")
      .max(
        GENERATE_PROMPT_MAX,
        `Use ${GENERATE_PROMPT_MAX.toLocaleString("en-US")} characters or fewer.`,
      ),
    length: z.enum(GENERATE_LENGTHS),
    withTitle: z.boolean(),
    useContext: z.boolean(),
  })
  .refine((v) => (v.target === "new") === (v.targetId === undefined), {
    message: "Send a target id for a note or task, and none for a new note.",
    path: ["targetId"],
  });

export const planDayRequestSchema = z.strictObject({});

export const editSelectionRequestSchema = z
  .strictObject({
    mode: z.enum(EDIT_MODES),
    text: z.string().max(EDIT_TEXT_MAX, "Select a shorter passage."),
    before: z.string().max(EDIT_BEFORE_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "CONTINUE") {
      if (!v.before?.trim() && !v.text.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["before"],
          message: "There is nothing to continue from.",
        });
      }
    } else {
      if (!v.text.trim()) {
        ctx.addIssue({ code: "custom", path: ["text"], message: "Select some text first." });
      }
      if (v.before !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["before"],
          message: "Only Continue uses text before the cursor.",
        });
      }
    }
  });
