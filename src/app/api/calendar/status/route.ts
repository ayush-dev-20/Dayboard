import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getStatus } from "@/lib/calendar/store";
import { requireUser } from "@/lib/session";
import { handle } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// The person's connections, calendars and last sync. No tokens.
export async function GET() {
  return handle("calendar.status", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    const user = await requireUser();
    return Response.json(await getStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  });
}
