import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { voiceIdSchema } from "@/lib/validations/voice";
import { finalizeVoiceCapture } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
// Without a worker this call runs the transcription itself, for up to 25 seconds (feature 13 §4.5).
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

// Step 2: look at what arrived (size, and the first bytes) and queue the transcription, or reject the
// recording and remove it. Safe to call again.
export async function POST(_request: Request, { params }: Context) {
  return handle("voice.finalize", async () => {
    const user = await requireUser();
    const parsed = voiceIdSchema.safeParse({ id: (await params).id });
    if (!parsed.success) throw new AppError("NOT_FOUND");
    const capture = await finalizeVoiceCapture(user.id, parsed.data.id);
    return Response.json({ capture }, { headers: { "Cache-Control": "no-store" } });
  });
}
