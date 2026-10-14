import { handle, readJson } from "@/lib/api-route";
import { requireUser } from "@/lib/session";
import { voiceIntentSchema } from "@/lib/validations/voice";
import { createVoiceIntent, listVoiceCaptures } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Step 1 of a voice capture (V2 feature 13 §8): check the recording's type, size and length and the
// person's rate, then hand back a short-lived URL to PUT the audio to. The audio never passes through
// this server.
export async function POST(request: Request) {
  return handle("voice.intent", async () => {
    const user = await requireUser();
    const body = await readJson(request, voiceIntentSchema);
    return Response.json(await createVoiceIntent(user.id, body), { headers: NO_STORE });
  });
}

/** The person's captures that are still in play (the Inbox list). */
export async function GET() {
  return handle("voice.list", async () => {
    const user = await requireUser();
    return Response.json({ captures: await listVoiceCaptures(user.id) }, { headers: NO_STORE });
  });
}
