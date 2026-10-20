import { handle, readJson } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { sendTest, testsSentLastHour, TEST_LIMIT_PER_HOUR } from "@/lib/notifications/deliver";
import { testPayload } from "@/lib/notifications/payload";
import { requireUser } from "@/lib/session";
import { testNotificationSchema } from "@/lib/validations/notifications";

export const dynamic = "force-dynamic";

/** Sends a test to one of the person's own devices. Three an hour. */
export async function POST(request: Request) {
  return handle("notifications.test", async () => {
    const user = await requireUser();
    const { subscriptionId } = await readJson(request, testNotificationSchema);
    const now = new Date();
    if ((await testsSentLastHour(user.id, now)) >= TEST_LIMIT_PER_HOUR) {
      throw new AppError("RATE_LIMITED", "That's enough tests for now. Try again in a while.");
    }
    const result = await sendTest(user.id, subscriptionId, testPayload());
    if (!result.ok) {
      throw new AppError(
        "CONFLICT",
        "That device couldn't be reached. Try enabling notifications again.",
      );
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
