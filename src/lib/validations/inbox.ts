import { z } from "zod";
import { LIMITS } from "@/lib/inbox/convert";
import { dateSchema, idSchema } from "./tasks";

export const INBOX_TEXT_MAX = 5000;

export const inboxTextSchema = z
  .string()
  .trim()
  .min(1, "Write something to capture.")
  .max(INBOX_TEXT_MAX, `Use ${INBOX_TEXT_MAX.toLocaleString("en-US")} characters or fewer.`);

export const captureInboxSchema = z.strictObject({ text: inboxTextSchema });
export const updateInboxSchema = z.strictObject({ id: idSchema, text: inboxTextSchema });

const title = (max: number) =>
  z.string().trim().min(1, "Enter a title.").max(max, `Use ${max} characters or fewer.`);
const optionalProject = idSchema.nullish();
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max.toLocaleString("en-US")} characters or fewer.`);

// One shape per target. Every conversion is confirmed by the person, so every field is editable.
export const convertInboxSchema = z.discriminatedUnion("target", [
  z.strictObject({
    id: idSchema,
    target: z.literal("task"),
    title: title(LIMITS.task),
    description: plain(INBOX_TEXT_MAX).optional(),
    projectId: optionalProject,
    dueDate: dateSchema.nullish(),
    /** Keep it as an Inbox-status task instead of Planned. */
    decideLater: z.boolean().optional(),
  }),
  z.strictObject({
    id: idSchema,
    target: z.literal("todo"),
    title: title(LIMITS.todo),
    projectId: optionalProject,
    dueDate: dateSchema.nullish(),
  }),
  z.strictObject({
    id: idSchema,
    target: z.literal("note"),
    title: title(LIMITS.note),
    body: plain(INBOX_TEXT_MAX),
    projectId: optionalProject,
  }),
  z.strictObject({
    id: idSchema,
    target: z.literal("task_note"),
    title: title(LIMITS.task),
    body: plain(INBOX_TEXT_MAX),
    projectId: optionalProject,
    dueDate: dateSchema.nullish(),
  }),
  z.strictObject({
    id: idSchema,
    target: z.literal("project"),
    name: title(LIMITS.project),
    description: plain(LIMITS.projectDescription).optional(),
  }),
]);

export const inboxIdSchema = z.strictObject({ id: idSchema });

export type ConvertInboxInput = z.infer<typeof convertInboxSchema>;
