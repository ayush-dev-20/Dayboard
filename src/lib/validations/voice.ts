import { z } from "zod";
import { VOICE_KINDS } from "@/lib/ai/schemas";
import { VOICE_MAX_ITEMS } from "@/lib/voice/types";
import { clientIdSchema, dateSchema, idSchema, taskPrioritySchema } from "./tasks";

// Voice capture inputs (V2 feature 13). Strict, so a client-sent `userId` or `status` is rejected.

/** Step 1: the recording exists on the device and wants an upload. The id was made there (UUIDv7). */
export const voiceIntentSchema = z.strictObject({
  id: clientIdSchema,
  mimeType: z.string().min(1).max(100),
  // Size and length limits are checked by the service, so they answer with their own codes.
  sizeBytes: z.number().int().min(1),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),
});

export const voiceIdSchema = z.strictObject({ id: idSchema });

const titleSchema = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(200, "Use 200 characters or fewer.");

/** One reviewed item. Whatever the person left ticked, as edited. */
export const confirmItemSchema = z.strictObject({
  kind: z.enum(VOICE_KINDS),
  title: titleSchema,
  body: z.string().trim().max(5000).nullish(),
  dueDate: dateSchema.nullish(),
  priority: taskPrioritySchema.optional(),
  projectId: idSchema.nullish(),
});

/** Step 3: create what the person confirmed. Nothing exists before this. */
export const confirmVoiceSchema = z
  .strictObject({
    captureId: idSchema,
    items: z.array(confirmItemSchema).max(VOICE_MAX_ITEMS),
    /** "Create note from transcript": the edited transcript as one more note. */
    transcriptNote: z
      .strictObject({
        title: z.string().trim().max(200),
        text: z.string().trim().min(1).max(20_000),
      })
      .nullish(),
    keepAudio: z.boolean(),
  })
  .refine((v) => v.items.length > 0 || Boolean(v.transcriptNote), {
    message: "Choose at least one thing to create.",
    path: ["items"],
  });
export type ConfirmVoiceInput = z.infer<typeof confirmVoiceSchema>;

export const undoVoiceSchema = z.strictObject({
  tasks: z.array(idSchema).max(VOICE_MAX_ITEMS + 1),
  todos: z.array(idSchema).max(VOICE_MAX_ITEMS + 1),
  notes: z.array(idSchema).max(VOICE_MAX_ITEMS + 1),
});
export type UndoVoiceInput = z.infer<typeof undoVoiceSchema>;
