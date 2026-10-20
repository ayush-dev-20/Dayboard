import { handle, readJson } from "@/lib/api-route";
import { touchDevice } from "@/lib/notifications/subscriptions";
import { requireUser } from "@/lib/session";
import { heartbeatSchema } from "@/lib/validations/notifications";

export const dynamic = "force-dynamic";

/** An open, focused tab says so: the device is looking at the app, so its reminders show in the app instead. */
export async function POST(request: Request) {
  return handle("notifications.heartbeat", async () => {
    const user = await requireUser();
    const { deviceId } = await readJson(request, heartbeatSchema);
    await touchDevice(user.id, deviceId);
    return new Response(null, { status: 204 });
  });
}
