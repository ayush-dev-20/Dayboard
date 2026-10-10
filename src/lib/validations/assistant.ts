import { z } from "zod";
import { CONTEXT_TYPES, MAX_CONTEXTS, MAX_HISTORY, MESSAGE_MAX } from "@/lib/ai/assistant-types";
import {
  dateSchema,
  idSchema,
  taskPrioritySchema,
  taskStatusSchema,
  taskTitleSchema,
} from "./tasks";

// One schema per assistant entry (feature 11). Records are always named by id and owner-checked on the
// server; the model's proposals are validated here before anything is shown, and again before anything
// is applied.

export const contextRefSchema = z.strictObject({ type: z.enum(CONTEXT_TYPES), id: idSchema });

export const chatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z
    .string()
    .trim()
    .min(1)
    .max(MESSAGE_MAX, `Use ${MESSAGE_MAX.toLocaleString("en-US")} characters or fewer.`),
});

/**
 * One assistant turn: the last ten messages (the newest is the question), and optionally the items the
 * person pointed the assistant at. `context` is the single-item form of `contexts`.
 */
export const assistantRequestSchema = z
  .strictObject({
    messages: z.array(chatMessageSchema).min(1).max(MAX_HISTORY),
    context: contextRefSchema.optional(),
    contexts: z
      .array(contextRefSchema)
      .max(MAX_CONTEXTS, `Pick up to ${MAX_CONTEXTS} items.`)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.messages.at(-1)?.role !== "user") {
      ctx.addIssue({ code: "custom", path: ["messages"], message: "Ask a question." });
    }
    if (value.messages[0]?.role !== "user") {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "A conversation starts with a question.",
      });
    }
    if (value.context && value.contexts) {
      ctx.addIssue({ code: "custom", path: ["contexts"], message: "Send one or the other." });
    }
  });
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

// ---- Proposals ----------------------------------------------------------------------------------

const MAX_ROWS = 15;

const taskFields = z
  .strictObject({
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dateSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Change at least one thing.");

export const createRowSchema = z.strictObject({
  title: taskTitleSchema,
  dueDate: dateSchema.nullish(),
  priority: taskPrioritySchema.optional(),
  projectId: idSchema.nullish(),
  linkNoteId: idSchema.nullish(),
});
export const updateRowSchema = z.strictObject({ taskId: idSchema, set: taskFields });
export const linkRowSchema = z.strictObject({ taskId: idSchema, noteId: idSchema });

/** What the model sends to `proposeTaskChanges`, and what the person's confirmed rows look like. */
export const proposalBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("createTasks"),
    items: z.array(createRowSchema).min(1).max(MAX_ROWS),
  }),
  z.strictObject({
    kind: z.literal("updateTasks"),
    changes: z.array(updateRowSchema).min(1).max(MAX_ROWS),
  }),
  z.strictObject({
    kind: z.literal("linkNotes"),
    links: z.array(linkRowSchema).min(1).max(MAX_ROWS),
  }),
]);
export type ProposalBody = z.infer<typeof proposalBodySchema>;

/** The Server Action's input: the ticked (and possibly edited) rows of one proposal. */
export const applyProposalSchema = z
  .strictObject({ proposalId: z.string().trim().min(8).max(64) })
  .and(proposalBodySchema);
export type ApplyProposalInput = z.infer<typeof applyProposalSchema>;

// ---- Chips and pickers --------------------------------------------------------------------------

export const describeItemsSchema = z.strictObject({
  items: z
    .array(contextRefSchema)
    .min(1)
    .max(MAX_CONTEXTS * 2),
});
export const findItemsSchema = z.strictObject({ query: z.string().trim().max(100) });
export const relatedSchema = z.strictObject({ type: z.enum(["note", "task"]), id: idSchema });

// ---- Ask AI about a selection (feature 11 §6B) --------------------------------------------------

export const ASK_SELECTION_MAX = 6000;
export const ASK_QUESTION_MAX = 500;
export const askSelectionRequestSchema = z.strictObject({
  ownerType: z.enum(["note", "task"]),
  ownerId: idSchema,
  selection: z
    .string()
    .trim()
    .min(1, "Select some text first.")
    .max(ASK_SELECTION_MAX, "Select a shorter passage."),
  question: z
    .string()
    .trim()
    .min(2, "Ask a question.")
    .max(ASK_QUESTION_MAX, `Use ${ASK_QUESTION_MAX} characters or fewer.`),
});
export type AskSelectionRequest = z.infer<typeof askSelectionRequestSchema>;
