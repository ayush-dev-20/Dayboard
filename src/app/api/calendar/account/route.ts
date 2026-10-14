import { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { disconnectAccount } from "@/lib/calendar/store";
import { requireUser } from "@/lib/session";
import { handle, readJson } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ accountId: z.uuid() });

// Disconnects a Google account: revokes at Google (best effort) and removes everything of it here, at once.
export async function DELETE(request: Request) {
  return handle("calendar.disconnect", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    const user = await requireUser();
    const { accountId } = await readJson(request, bodySchema);
    await disconnectAccount(user.id, accountId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
