import { z } from "zod";
import { OWNER_TYPES } from "@/lib/storage/types";
import { idSchema } from "./tasks";

export const ownerTypeSchema = z.enum(OWNER_TYPES);

const dimension = z.number().int().min(1).max(100_000);

export const intentSchema = z.strictObject({
  id: idSchema.optional(),
  ownerType: ownerTypeSchema,
  ownerId: idSchema,
  name: z.string().min(1, "This file has no name.").max(1000),
  mime: z.string().max(255),
  size: z.number().int().min(0),
  width: dimension.nullish(),
  height: dimension.nullish(),
});

export const finalizeSchema = z.strictObject({ id: idSchema });

export const listQuerySchema = z.strictObject({ ownerType: ownerTypeSchema, ownerId: idSchema });

export type IntentBody = z.infer<typeof intentSchema>;
