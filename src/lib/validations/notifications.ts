import { z } from "zod";
import { NOTIFICATION_CATEGORIES } from "@/lib/notifications/categories";
import { idSchema } from "./tasks";

// Inputs of the notification settings and reminders (V2 feature 14 §6). Strict: unknown keys, such as a client-sent
// `userId`, are refused.

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 22:00.");

export const setCategorySchema = z.strictObject({
  category: z.enum(NOTIFICATION_CATEGORIES),
  enabled: z.boolean(),
});

/** Both ends, or null to switch quiet hours off. */
export const setQuietHoursSchema = z.strictObject({
  quiet: z
    .strictObject({ start: timeOfDay, end: timeOfDay })
    .refine((q) => q.start !== q.end, "Choose two different times.")
    .nullable(),
});

export const setReminderDefaultsSchema = z.strictObject({
  leadMinutes: z.number().int().min(0).max(1440).optional(),
  showTitles: z.boolean().optional(),
});

export const setTaskRemindersSchema = z.strictObject({
  taskId: idSchema,
  // Checked again against the spec's own schema when applied.
  reminders: z.array(z.unknown()).max(3),
});

export const taskIdSchema = z.strictObject({ taskId: idSchema });

export const reminderIdSchema = z.strictObject({ id: idSchema });

export const snoozeReminderSchema = z.strictObject({
  id: idSchema,
  choice: z.enum(["15m", "1h", "tomorrow"]),
});

export const snoozeTokenSchema = z.strictObject({ token: z.string().min(10).max(1024) });

export const testNotificationSchema = z.strictObject({ subscriptionId: idSchema });

export const heartbeatSchema = z.strictObject({ deviceId: z.uuid() });
