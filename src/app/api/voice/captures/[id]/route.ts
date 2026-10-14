import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { voiceIdSchema } from "@/lib/validations/voice";
import { discardVoiceCapture, getVoiceCapture } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function idOf({ params }: Context): Promise<string> {
  const parsed = voiceIdSchema.safeParse({ id: (await params).id });
  // Not a UUID is the same answer as someone else's capture.
  if (!parsed.success) throw new AppError("NOT_FOUND");
  return parsed.data.id;
}

/** Status and, when ready, the transcript and the reviewable list. Owner only. */
export async function GET(_request: Request, context: Context) {
  return handle("voice.get", async () => {
    const user = await requireUser();
    const capture = await getVoiceCapture(user.id, await idOf(context));
    return Response.json({ capture }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Discard: the recording, the transcript and the row are removed. */
export async function DELETE(_request: Request, context: Context) {
  return handle("voice.discard", async () => {
    const user = await requireUser();
    await discardVoiceCapture(user.id, await idOf(context));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
