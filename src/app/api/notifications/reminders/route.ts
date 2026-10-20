import { handle } from "@/lib/api-route";
import { dueInApp, upcomingInApp } from "@/lib/notifications/reminders";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Reminders that have come due and are waiting in the app (the Today banner refreshes from this). */
export async function GET() {
  return handle("notifications.reminders", async () => {
    const user = await requireUser();
    const [reminders, upcoming] = await Promise.all([dueInApp(user.id), upcomingInApp(user.id)]);
    return Response.json({ reminders, upcoming }, { headers: { "Cache-Control": "no-store" } });
  });
}
