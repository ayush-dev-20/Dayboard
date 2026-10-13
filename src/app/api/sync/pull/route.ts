import { z } from "zod";
import { pullTaskChanges } from "@/db/queries/sync";
import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { MAX_PULL_PAGE } from "@/lib/sync/operations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_PAGE).default(MAX_PULL_PAGE),
});

// Changes made since a cursor, for this person only (V2 feature 05 §3). Never cached.
export async function GET(request: Request) {
  return handle("sync.pull", async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "That request isn't valid.");

    const body = await pullTaskChanges(user.id, parsed.data);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
}
