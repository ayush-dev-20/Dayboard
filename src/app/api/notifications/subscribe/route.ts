import { handle, readJson } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { deviceLabel } from "@/lib/notifications/device-label";
import { requireSameSiteWithToken } from "@/lib/notifications/route-guard";
import { registerSubscription, subscribeSchema } from "@/lib/notifications/subscriptions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Saves this device's push subscription (V2 feature 14 §6). Session, same site and a double-submit token. */
export async function POST(request: Request) {
  return handle("notifications.subscribe", async () => {
    const user = await requireUser();
    if (!env.pushAvailable)
      throw new AppError("CONFLICT", "Notifications aren't set up on this server.");
    requireSameSiteWithToken(request);
    const input = await readJson(request, subscribeSchema);
    const device = await registerSubscription(
      user.id,
      input,
      deviceLabel(request.headers.get("user-agent")),
    );
    return Response.json({ device }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
