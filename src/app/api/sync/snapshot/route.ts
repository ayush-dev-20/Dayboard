import { z } from "zod";
import { snapshotPreferences, snapshotTasks } from "@/db/queries/sync";
import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { SNAPSHOT_ENTITIES, SNAPSHOT_MAX_LIMIT } from "@/lib/sync/snapshot";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity: z.enum(SNAPSHOT_ENTITIES),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(SNAPSHOT_MAX_LIMIT).default(SNAPSHOT_MAX_LIMIT),
});

// Bootstrap for the offline app (V2 feature 04 §4): the signed-in person's own rows, a page at a time.
// Never cached: the answer is personal.
export async function GET(request: Request) {
  return handle("sync.snapshot", async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      entity: url.searchParams.get("entity") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "That request isn't valid.");
    const { entity, cursor, limit } = parsed.data;

    const body =
      entity === "tasks"
        ? await snapshotTasks(user.id, { cursor: cursor ?? null, limit })
        : await snapshotPreferences(user.id);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
}
