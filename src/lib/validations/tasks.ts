import { z } from "zod";
import { isValidDateString } from "@/lib/dates/calendar";
import { isSingleEmoji } from "@/lib/emoji";
import { richTextSchema } from "@/lib/editor/schema";
import { isValidRule } from "@/lib/tasks/recurrence";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/status";

export const idSchema = z.uuid("That item isn't valid.");

const titleOf = (max: number) =>
  z.string().trim().min(1, "Enter a title.").max(max, `Use ${max} characters or fewer.`);
export const taskTitleSchema = titleOf(500);
export const todoTitleSchema = titleOf(300);

export const emojiSchema = z.string().refine(isSingleEmoji, "Choose a single emoji.");
export const dateSchema = z.string().refine(isValidDateString, "Choose a valid date.");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 18:00.");
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const recurrenceRuleSchema = z
  .string()
  .refine(isValidRule, "Choose a repeat from the list.");

type DateFields = {
  dueDate?: string | null;
  dueTime?: string | null;
  startDate?: string | null;
  startTime?: string | null;
  recurrenceRule?: string | null;
  parentTaskId?: string | null;
};

// Only checks fields that are present together. The server checks the merged result on update.
function dateRules(value: DateFields, ctx: z.RefinementCtx) {
  if (value.dueTime && value.dueDate === null) {
    ctx.addIssue({ code: "custom", path: ["dueTime"], message: "Choose a due date first." });
  }
  if (value.startTime && value.startDate === null) {
    ctx.addIssue({ code: "custom", path: ["startTime"], message: "Choose a start date first." });
  }
  if (value.recurrenceRule && value.dueDate === null) {
    ctx.addIssue({
      code: "custom",
      path: ["recurrenceRule"],
      message: "A repeating task needs a due date.",
    });
  }
  if (value.recurrenceRule && value.parentTaskId) {
    ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Subtasks can't repeat." });
  }
}

// Strict: unknown keys (a client-sent userId, projectId before projects exist) are rejected.
export const createTaskSchema = z
  .strictObject({
    title: taskTitleSchema,
    emoji: emojiSchema.nullish(),
    projectId: idSchema.nullish(),
    parentTaskId: idSchema.nullish(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dateSchema.nullish(),
    dueTime: timeSchema.nullish(),
    startDate: dateSchema.nullish(),
    startTime: timeSchema.nullish(),
    recurrenceRule: recurrenceRuleSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.dueTime && !value.dueDate) {
      ctx.addIssue({ code: "custom", path: ["dueTime"], message: "Choose a due date first." });
    }
    if (value.startTime && !value.startDate) {
      ctx.addIssue({ code: "custom", path: ["startTime"], message: "Choose a start date first." });
    }
    if (value.recurrenceRule && !value.dueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrenceRule"],
        message: "A repeating task needs a due date.",
      });
    }
    if (value.recurrenceRule && value.parentTaskId) {
      ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Subtasks can't repeat." });
    }
  });

export const updateTaskSchema = z
  .strictObject({
    id: idSchema,
    title: taskTitleSchema.optional(),
    emoji: emojiSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dateSchema.nullable().optional(),
    dueTime: timeSchema.nullable().optional(),
    startDate: dateSchema.nullable().optional(),
    startTime: timeSchema.nullable().optional(),
    recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => dateRules(value, ctx));

export const updateTaskDescriptionSchema = z.strictObject({
  id: idSchema,
  descriptionJson: richTextSchema.nullable(),
});

// Several tasks at once, from an AI preview the person has confirmed (feature 05). Up to 15, all or
// nothing. `parentTaskId` makes them subtasks; `linkNoteId` links every new task to that note.
export const MAX_BATCH_TASKS = 15;
export const createTasksBatchSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ title: taskTitleSchema, dueDate: dateSchema.nullish() }))
      .min(1, "Choose at least one task.")
      .max(MAX_BATCH_TASKS, `Create up to ${MAX_BATCH_TASKS} tasks at a time.`),
    parentTaskId: idSchema.nullish(),
    linkNoteId: idSchema.nullish(),
    projectId: idSchema.nullish(),
    /** Marks this inbox item converted to the new tasks, in the same transaction. */
    fromInboxItemId: idSchema.nullish(),
  })
  .refine((v) => [v.parentTaskId, v.linkNoteId, v.fromInboxItemId].filter(Boolean).length <= 1, {
    message: "Choose subtasks, a linked note or an inbox item, not a mix.",
  });

export const setTaskStatusSchema = z.strictObject({ id: idSchema, status: taskStatusSchema });
export const idOnlySchema = z.strictObject({ id: idSchema });

export const undoCompleteSchema = z.strictObject({
  id: idSchema,
  previousStatus: taskStatusSchema,
  nextOccurrenceId: idSchema.nullish(),
});

// `beforeId` is the item that will sit immediately above the moved one, `afterId` immediately below.
export const reorderSchema = z.strictObject({
  id: idSchema,
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});

export const createTodoSchema = z.strictObject({
  title: todoTitleSchema,
  emoji: emojiSchema.nullish(),
  projectId: idSchema.nullish(),
  dueDate: dateSchema.nullish(),
});

export const updateTodoSchema = z.strictObject({
  id: idSchema,
  title: todoTitleSchema.optional(),
  emoji: emojiSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
});

export const setTodoCompleteSchema = z.strictObject({ id: idSchema, isComplete: z.boolean() });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateTasksBatchInput = z.infer<typeof createTasksBatchSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
