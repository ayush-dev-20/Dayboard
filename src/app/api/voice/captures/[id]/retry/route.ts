import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { voiceIdSchema } from "@/lib/validations/voice";
import { retryVoiceCapture } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** Runs a failed capture again (it needs the recording, which is kept for a day). */
export async function POST(_request: Request, { params }: Context) {
  return handle("voice.retry", async () => {
    const user = await requireUser();
    const parsed = voiceIdSchema.safeParse({ id: (await params).id });
    if (!parsed.success) throw new AppError("NOT_FOUND");
    const capture = await retryVoiceCapture(user.id, parsed.data.id);
    return Response.json({ capture }, { headers: { "Cache-Control": "no-store" } });
  });
}
