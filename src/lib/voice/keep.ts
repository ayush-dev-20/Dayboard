import "server-only";
import { db } from "@/db/client";
import { attachments, type VoiceCapture } from "@/db/schema";
import { usedBytes } from "@/db/queries/attachments";
import { env } from "@/lib/env";
import { uuidv7 } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { createStorageKey } from "@/lib/storage/keys";
import { VOICE_AUDIO_TYPES } from "@/lib/storage/policy";
import { checkLimits } from "@/lib/storage/quota";

// "Keep the recording" (V2 feature 13 §2, §6): the temporary audio becomes a normal attachment of the
// note (or, with no note, the first task) the person just created. The object is copied to a
// permanent key inside the storage service, so the bytes never pass through this server, and the
// temporary one is deleted by the caller afterwards. The person's storage allowance applies, like any file.

export type KeepTarget = { ownerType: "NOTE" | "TASK"; ownerId: string };

/** Returns true when the recording is now an attachment; false when it could not be kept (the rest is unaffected). */
export async function keepRecording(
  userId: string,
  capture: Pick<VoiceCapture, "storageKey" | "mimeType" | "sizeBytes" | "createdAt">,
  target: KeepTarget,
): Promise<boolean> {
  const storage = getStorage();
  if (!storage || !capture.storageKey) return false;
  try {
    const verdict = checkLimits({
      personBytes: await usedBytes(db, userId),
      totalBytes: await usedBytes(db),
      addingBytes: capture.sizeBytes,
      personLimitBytes: env.storageQuotaBytes,
      totalLimitBytes: env.storageTotalLimitBytes,
    });
    if (!verdict.ok) return false;

    const id = uuidv7();
    const key = createStorageKey(userId, id);
    if (!(await storage.copy(capture.storageKey, key))) return false;
    const extension = VOICE_AUDIO_TYPES[capture.mimeType] ?? "webm";
    const day = capture.createdAt.toISOString().slice(0, 10);
    await db.insert(attachments).values({
      id,
      userId,
      ownerType: target.ownerType,
      ownerId: target.ownerId,
      storageKey: key,
      originalName: `Voice recording ${day}.${extension}`,
      mimeType: capture.mimeType,
      sizeBytes: capture.sizeBytes,
      status: "READY",
      finalizedAt: new Date(),
    });
    return true;
  } catch (error) {
    logger.warn("could not keep a recording", { error });
    return false;
  }
}
