import { z } from "zod";
import { isValidTimeZone } from "@/lib/dates/timezones";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Use 80 characters or fewer.");

export const themeSchema = z.enum(["light", "dark", "system"]);
export const timeZoneSchema = z.string().refine(isValidTimeZone, "Choose a valid time zone.");
export const startOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 06:00.");
export const prioritySchema = z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]);
export const providerSchema = z.enum(["google", "github"]);

export const onboardingSchema = z.object({
  name: nameSchema,
  timezone: timeZoneSchema,
  theme: themeSchema,
});

export const updateProfileSchema = z.object({ name: nameSchema });

// Strict on purpose: unknown keys (for example a client-sent `userId`) are rejected, never ignored.
export const updatePreferencesSchema = z.strictObject({
  theme: themeSchema.optional(),
  timezone: timeZoneSchema.optional(),
  defaultTaskPriority: prioritySchema.optional(),
  startOfDay: startOfDaySchema.optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  aiEnabled: z.boolean().optional(),
});

export const changeEmailSchema = z.object({
  newEmail: z.email("Enter a valid email address.").max(254),
});

export const newPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use 128 characters or fewer.");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: newPasswordSchema,
});

export const setPasswordSchema = z.object({ newPassword: newPasswordSchema });

export const unlinkProviderSchema = z.object({ provider: providerSchema });
export const revokeSessionSchema = z.object({ sessionId: z.string().min(1) });

export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", { error: "Type DELETE to confirm." }),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
