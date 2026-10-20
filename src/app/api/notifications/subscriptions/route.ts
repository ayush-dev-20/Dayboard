import { handle } from "@/lib/api-route";
import { listSubscriptions } from "@/lib/notifications/subscriptions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The person's own devices. */
export async function GET() {
  return handle("notifications.devices", async () => {
    const user = await requireUser();
    return Response.json(
      { devices: await listSubscriptions(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
