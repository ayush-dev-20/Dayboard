import { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { setCalendarSelected } from "@/lib/calendar/store";
import { requireUser } from "@/lib/session";
import { handle, readJson } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ sourceId: z.uuid(), selected: z.boolean() });

// Turns one calendar on or off for this person.
export async function POST(request: Request) {
  return handle("calendar.select", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    const user = await requireUser();
    const { sourceId, selected } = await readJson(request, bodySchema);
    await setCalendarSelected(user.id, sourceId, selected);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
