import { z } from "zod";
import { MAX_TAG_NAME, MAX_TAGS_PER_ITEM, cleanTagName } from "@/lib/tags";
import { colorSchema } from "./projects";
import { idSchema } from "./tasks";

export const tagNameSchema = z
  .string()
  .transform(cleanTagName)
  .pipe(
    z
      .string()
      .min(1, "Enter a tag name.")
      .max(MAX_TAG_NAME, `Use ${MAX_TAG_NAME} characters or fewer.`),
  );

export const createTagSchema = z.strictObject({
  name: tagNameSchema,
  color: colorSchema.nullish(),
});

export const renameTagSchema = z.strictObject({ id: idSchema, name: tagNameSchema });

export const setTagColorSchema = z.strictObject({ id: idSchema, color: colorSchema.nullable() });

export const setTagsSchema = z.strictObject({
  id: idSchema,
  tagIds: z
    .array(idSchema)
    .max(MAX_TAGS_PER_ITEM, `Up to ${MAX_TAGS_PER_ITEM} tags per item.`)
    .transform((ids) => [...new Set(ids)]),
});

export const deleteTagSchema = z.strictObject({ id: idSchema });

export type CreateTagInput = z.infer<typeof createTagSchema>;
