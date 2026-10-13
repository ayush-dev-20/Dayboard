import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { processPush } from "@/lib/sync/push";
import { MAX_PUSH_BYTES, pushRequestSchema } from "@/lib/sync/operations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// The device sends its queued changes (V2 feature 05 §3). Each one gets its own result; a bad one never
// fails the batch. Never cached.
export async function POST(request: Request) {
  return handle("sync.push", async () => {
    const user = await requireUser();
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PUSH_BYTES) {
      throw new AppError("VALIDATION_ERROR", "That's too much to send at once.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_ERROR", "That request wasn't readable.");
    }
    const parsed = pushRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "That request isn't valid.");

    const results = await processPush(user.id, parsed.data);
    return Response.json(
      { results, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
