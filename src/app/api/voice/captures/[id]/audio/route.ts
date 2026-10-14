import { handle } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { VOICE_AUDIO_TYPES } from "@/lib/storage/policy";
import { voiceIdSchema } from "@/lib/validations/voice";
import { voiceAudioLocation } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Playing the recording in the review step (V2 feature 13 §6): the session is checked, then the browser is
 * sent (302) to a 60-second signed URL, so the audio goes from storage to the browser and never through
 * this server. Someone else's capture, a missing one and one whose recording is gone are all `NOT_FOUND`.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle("voice.audio", async () => {
    const user = await requireUser();
    const parsed = voiceIdSchema.safeParse({ id: (await params).id });
    if (!getStorage() || !parsed.success) throw new AppError("NOT_FOUND");
    const { key, mime } = await voiceAudioLocation(user.id, parsed.data.id);
    const location = await getStorage()!.createDownloadUrl(key, {
      filename: `recording.${VOICE_AUDIO_TYPES[mime] ?? "webm"}`,
      disposition: "inline",
      mime,
      expiresIn: 60,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Cache-Control": "private, max-age=45",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
