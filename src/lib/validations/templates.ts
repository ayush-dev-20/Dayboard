import { z } from "zod";
import { EditorDocError } from "@/lib/editor/schema";
import { STARTER_KEYS } from "@/lib/templates/starters";
import { sanitizeTemplateDoc } from "@/lib/templates/schema";
import { TEMPLATE_NAME_MAX, TITLE_PATTERN_MAX } from "@/lib/templates/types";
import { emojiSchema, idSchema } from "./tasks";

// Inputs of the template actions (V3 feature 03 §5). Strict: unknown keys, such as a client-sent `userId`, `starterKey`
// or text copy, are refused. The document goes through `sanitizeTemplateDoc`, which refuses images, files and sub-notes
// with a plain message.

const squash = (v: string) => v.replace(/\s+/g, " ").trim();

export const templateNameSchema = z
  .string()
  .transform(squash)
  .pipe(
    z
      .string()
      .min(1, "Give the template a name.")
      .max(TEMPLATE_NAME_MAX, `Use ${TEMPLATE_NAME_MAX} characters or fewer.`),
  );

export const titlePatternSchema = z
  .string()
  .max(TITLE_PATTERN_MAX, `Use ${TITLE_PATTERN_MAX} characters or fewer.`)
  .transform((v) => v.replace(/[\r\n]+/g, " ").trim());

export const templateDocSchema = z.unknown().transform((value, ctx) => {
  try {
    return sanitizeTemplateDoc(value);
  } catch (error) {
    if (error instanceof EditorDocError) {
      ctx.issues.push({ code: "custom", message: error.message, input: value });
      return z.NEVER;
    }
    throw error;
  }
});

export const createTemplateSchema = z.strictObject({
  name: templateNameSchema.optional(),
  emoji: emojiSchema.nullish(),
  titlePattern: titlePatternSchema.optional(),
  contentJson: templateDocSchema.optional(),
});

export const saveTemplateSchema = z.strictObject({
  id: idSchema,
  version: z.number().int().min(1),
  contentJson: templateDocSchema.optional(),
  name: templateNameSchema.optional(),
  titlePattern: titlePatternSchema.optional(),
});

export const updateTemplateMetaSchema = z.strictObject({
  id: idSchema,
  name: templateNameSchema.optional(),
  emoji: emojiSchema.nullable().optional(),
});

export const templateIdSchema = z.strictObject({ id: idSchema });

export const createNoteFromTemplateSchema = z.strictObject({
  templateId: idSchema,
  projectId: idSchema.nullish(),
});

export const setJournalTemplateSchema = z.strictObject({ templateId: idSchema.nullable() });

export const addStarterTemplatesSchema = z.strictObject({
  keys: z.array(z.enum(STARTER_KEYS)).min(1).max(STARTER_KEYS.length),
});
