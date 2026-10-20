import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { taskReminders } from "@/db/schema";
import { handle, readJson } from "@/lib/api-route";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { snoozeReminder } from "@/lib/notifications/reminders";
import { verifySnoozeToken } from "@/lib/notifications/snooze-token";
import { requireUser } from "@/lib/session";
import { snoozeTokenSchema } from "@/lib/validations/notifications";

export const dynamic = "force-dynamic";

/** The notification's Snooze button: 15 minutes, with the signed token it carried and the person's session. */
export async function POST(request: Request) {
  return handle("notifications.snooze", async () => {
    const user = await requireUser();
    const { token } = await readJson(request, snoozeTokenSchema);
    const claim = verifySnoozeToken(token, env.BETTER_AUTH_SECRET);
    // A token made for someone else is no better than a bad one.
    if (!claim || claim.userId !== user.id)
      throw new AppError("UNAUTHORIZED", "That snooze link isn't valid.");

    const [row] = await db
      .select()
      .from(taskReminders)
      .where(
        and(
          eq(taskReminders.id, claim.reminderId),
          eq(taskReminders.userId, user.id),
          // Once snoozed it is SNOOZED, so the same token cannot snooze it again.
          inArray(taskReminders.status, ["PENDING", "SENT"]),
        ),
      )
      .limit(1);
    // The token names the notification it came with: a later one for the same reminder has a later stamp.
    if (!row || row.sentAt?.getTime() !== claim.stamp) {
      throw new AppError("CONFLICT", "That reminder has already been dealt with.");
    }
    await snoozeReminder(user.id, row.id, new Date(Date.now() + 15 * 60_000));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
