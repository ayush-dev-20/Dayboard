"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import {
  setCategoryEnabled,
  setQuietHours as writeQuietHours,
  setReminderDefaults as writeReminderDefaults,
} from "@/lib/notifications/preferences";
import {
  acknowledgeReminder,
  listTaskReminders,
  setCustomReminders,
  snoozeReminder,
  snoozeUntil,
  type ReminderDTO,
} from "@/lib/notifications/reminders";
import { requireUser } from "@/lib/session";
import {
  reminderIdSchema,
  setCategorySchema,
  setQuietHoursSchema,
  setReminderDefaultsSchema,
  setTaskRemindersSchema,
  snoozeReminderSchema,
  taskIdSchema,
} from "@/lib/validations/notifications";

// Server Actions of notifications and reminders (V2 feature 14 §6). Each starts with who is asking and writes only
// that person's rows.

export async function setNotificationPreferences(input: unknown): Promise<ActionResult> {
  return runAction("notifications.setPreferences", async () => {
    const user = await requireUser();
    const { category, enabled } = setCategorySchema.parse(input);
    await setCategoryEnabled(user.id, category, enabled);
    revalidatePath("/settings/notifications");
  });
}

export async function setQuietHours(input: unknown): Promise<ActionResult> {
  return runAction("notifications.setQuietHours", async () => {
    const user = await requireUser();
    await writeQuietHours(user.id, setQuietHoursSchema.parse(input).quiet);
    revalidatePath("/settings/notifications");
  });
}

export async function setReminderDefaults(input: unknown): Promise<ActionResult> {
  return runAction("notifications.setReminderDefaults", async () => {
    const user = await requireUser();
    await writeReminderDefaults(user.id, setReminderDefaultsSchema.parse(input));
    revalidatePath("/", "layout");
  });
}

/** The reminders waiting on a task (the chips under "Remind me"). */
export async function getTaskReminders(input: unknown): Promise<ActionResult<ReminderDTO[]>> {
  return runAction("notifications.getTaskReminders", async () => {
    const user = await requireUser();
    return listTaskReminders(user.id, taskIdSchema.parse(input).taskId);
  });
}

/** Replaces a task's custom reminders (the "Remind me" control). */
export async function setTaskReminders(input: unknown): Promise<ActionResult<ReminderDTO[]>> {
  return runAction("notifications.setTaskReminders", async () => {
    const user = await requireUser();
    const { taskId, reminders } = setTaskRemindersSchema.parse(input);
    const saved = await setCustomReminders(user.id, taskId, reminders);
    revalidatePath("/", "layout");
    return saved;
  });
}

/** Snooze from the in-app banner: 15 minutes, an hour, or tomorrow morning. */
export async function snoozeInApp(input: unknown): Promise<ActionResult> {
  return runAction("notifications.snooze", async () => {
    const user = await requireUser();
    const { id, choice } = snoozeReminderSchema.parse(input);
    await snoozeReminder(user.id, id, await snoozeUntil(user.id, choice));
    revalidatePath("/", "layout");
  });
}

/** Open or dismiss: the banner stops showing this reminder. */
export async function acknowledgeInApp(input: unknown): Promise<ActionResult> {
  return runAction("notifications.acknowledge", async () => {
    const user = await requireUser();
    await acknowledgeReminder(user.id, reminderIdSchema.parse(input).id);
    revalidatePath("/", "layout");
  });
}
