import "server-only";
import { isTranscriptionAvailable } from "@/lib/ai";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";

/** Voice is on for this person only when storage, a provider that takes audio, AI and the switch all agree. */
export async function voiceAvailableFor(userId: string): Promise<boolean> {
  return voiceEnabledFor(await getPreferences(userId));
}

/** The same answer from preferences already in hand (the app layout has them). */
export function voiceEnabledFor(prefs: {
  aiEnabled: boolean;
  voiceCaptureEnabled: boolean;
}): boolean {
  return (
    env.storageAvailable &&
    isTranscriptionAvailable() &&
    prefs.aiEnabled &&
    prefs.voiceCaptureEnabled
  );
}
