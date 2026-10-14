import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { manualSync } from "@/lib/calendar/manual";
import { requireUser } from "@/lib/session";
import { handle } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Sync now": reads the person's calendars right away. Six a hour.
export async function POST(request: Request) {
  return handle("calendar.sync", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    // A form from another site cannot send this type without a preflight.
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AppError("VALIDATION_ERROR", "That request wasn't readable.");
    }
    const user = await requireUser();
    const outcomes = await manualSync(user.id);
    return Response.json(
      {
        synced: outcomes.filter((o) => o.status === "synced").length,
        needsReconnect: outcomes.some((o) => o.status === "needs_reconnect"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
