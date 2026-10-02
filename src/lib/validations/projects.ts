import { z } from "zod";
import { COLOR_TOKENS } from "@/lib/colors";
import { PROJECT_STATUSES } from "@/lib/projects/status";
import { idSchema } from "./tasks";

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(100, "Use 100 characters or fewer.");

export const colorSchema = z.enum(COLOR_TOKENS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, "Use 2,000 characters or fewer.")
  .transform((v) => (v === "" ? null : v));

export const createProjectSchema = z.strictObject({
  name: projectNameSchema,
  description: descriptionSchema.nullish(),
  color: colorSchema.optional(),
  status: projectStatusSchema.optional(),
});

export const updateProjectSchema = z.strictObject({
  id: idSchema,
  name: projectNameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  color: colorSchema.optional(),
  status: projectStatusSchema.optional(),
});

export const ITEM_TYPES = ["task", "todo", "note"] as const;

export const assignToProjectSchema = z.strictObject({
  itemType: z.enum(ITEM_TYPES),
  itemId: idSchema,
  projectId: idSchema.nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AssignToProjectInput = z.infer<typeof assignToProjectSchema>;
