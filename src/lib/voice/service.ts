import "server-only";
import { and, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { voiceCaptures, type VoiceCapture } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/enqueue";
import { workerStatus } from "@/lib/jobs/maintenance";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { createVoiceKey } from "@/lib/storage/keys";
import { voiceMime } from "@/lib/storage/policy";
import { SNIFF_BYTES, sniffAudio } from "@/lib/storage/sniff";
import { voiceAvailableFor } from "./availability";
import { processCapture } from "./process";
import { audioIsDue, expiresAtFor, rowIsDue } from "./retention";
import {
  PENDING_STATUSES,
  VOICE_INLINE_BUDGET_MS,
  VOICE_INTENTS_PER_MINUTE,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  VOICE_UPLOAD_EXPIRES_IN,
  type ParsedCapture,
  type VoiceCaptureDetail,
  type VoiceCaptureDTO,
  type VoiceIntentResult,
} from "./types";

// Everything that creates, moves or removes a voice capture (V2 feature 13 §4, §8). The audio never
// passes through here: the browser uploads straight to storage, and `finalize` looks at what arrived.
// Every function takes the person from the session, and a capture that is not theirs is `NOT_FOUND`.

/** Allowed slack on the length: the recorder stops at the limit, but a timer is not exact. */
const DURATION_SLACK_MS = 5_000;

export function toDTO(row: VoiceCapture): VoiceCaptureDTO {
  return {
    id: row.id,
    status: row.status as VoiceCaptureDTO["status"],
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    keepAudio: row.keepAudio,
    errorCode: row.errorCode,
    hasAudio: row.storageKey !== null,
    language: row.language,
  };
}

function toDetail(row: VoiceCapture): VoiceCaptureDetail {
  const ready = row.status === "READY";
  return {
    ...toDTO(row),
    transcript: ready ? row.transcript : null,
    parsed: ready ? ((row.parsed as ParsedCapture | null) ?? null) : null,
  };
}

async function requireVoice(userId: string) {
  const storage = getStorage();
  // With no storage configured the feature is off: the routes look like they do not exist.
  if (!storage) throw new AppError("NOT_FOUND");
  if (!(await voiceAvailableFor(userId))) throw new AppError("AI_DISABLED");
  return storage;
}

async function ownedRow(userId: string, id: string): Promise<VoiceCapture> {
  const [row] = await db
    .select()
    .from(voiceCaptures)
    .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.userId, userId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * Step 1: checks the recording's type, size and length and the person's rate, writes an `UPLOADING` row
 * and returns a short-lived URL to PUT to. The id comes from the device, so a retry (or an offline
 * replay) finds its own row and gets a fresh URL for the same object. An id someone else holds is
 * refused without saying whose it is.
 */
export async function createVoiceIntent(
  userId: string,
  input: { id: string; mimeType: string; sizeBytes: number; durationMs: number },
): Promise<VoiceIntentResult> {
  const storage = await requireVoice(userId);

  const mime = voiceMime(input.mimeType);
  if (!mime) throw new AppError("UNSUPPORTED_FILE_TYPE", "That recording type isn't supported.");
  if (input.sizeBytes > VOICE_MAX_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "That recording is too long. The limit is 10 MB.");
  }
  if (input.durationMs > VOICE_MAX_MS + DURATION_SLACK_MS) {
    throw new AppError("FILE_TOO_LARGE", "That recording is too long. The limit is 5 minutes.");
  }

  const [existing] = await db
    .select()
    .from(voiceCaptures)
    .where(eq(voiceCaptures.id, input.id))
    .limit(1);
  if (existing && existing.userId !== userId) {
    throw new AppError("VALIDATION_ERROR", "That recording can't be used. Record it again.");
  }

  if (!existing) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(voiceCaptures)
      .where(
        and(
          eq(voiceCaptures.userId, userId),
          sql`${voiceCaptures.createdAt} > now() - interval '1 minute'`,
        ),
      );
    if ((recent?.n ?? 0) >= VOICE_INTENTS_PER_MINUTE) {
      throw new AppError("RATE_LIMITED", "Too many recordings at once. Try again in a moment.", {
        retryAfterSeconds: 60,
      });
    }
  }

  // A repeat of the same intent: the same row and object, a fresh URL while it is still uploading.
  if (existing && existing.status !== "UPLOADING") {
    return { capture: toDTO(existing), upload: null, expiresAt: existing.expiresAt.toISOString() };
  }

  const now = new Date();
  const key = existing?.storageKey ?? createVoiceKey(userId, input.id);
  const row =
    existing ??
    (
      await db
        .insert(voiceCaptures)
        .values({
          id: input.id,
          userId,
          status: "UPLOADING",
          storageKey: key,
          mimeType: mime,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs,
          expiresAt: expiresAtFor(now),
        })
        .onConflictDoNothing()
        .returning()
    )[0];
  if (!row)
    throw new AppError("VALIDATION_ERROR", "That recording can't be used. Record it again.");

  const upload = await storage.createUploadUrl(key, {
    mime: row.mimeType,
    size: row.sizeBytes,
    expiresIn: VOICE_UPLOAD_EXPIRES_IN,
  });
  return {
    capture: toDTO(row),
    upload,
    expiresAt: new Date(now.getTime() + VOICE_UPLOAD_EXPIRES_IN * 1000).toISOString(),
  };
}

/** Queues the job for a capture, and, when nothing else will run it soon, runs it here (feature 13 §4.5). */
async function queueAndRun(
  userId: string,
  id: string,
  options: { inline?: boolean },
): Promise<void> {
  await enqueue(db, {
    type: "transcription.process",
    payload: { captureId: id },
    userId,
    queue: "ai",
    maxAttempts: 3,
    dedupeKey: `transcription.process:${id}`,
    correlationId: id,
  });
  const inline = options.inline ?? (await workerStatus()) !== "ok";
  if (!inline) return;
  // The same handler the worker runs. It never throws: the result is in the row. A run that outlasts the
  // budget carries on in the background, and a stalled one is reclaimed by the next job pass.
  const run = processCapture(userId, id).catch((error) =>
    logger.warn("inline voice processing failed", { captureId: id, error }),
  );
  await Promise.race([run, new Promise((resolve) => setTimeout(resolve, VOICE_INLINE_BUDGET_MS))]);
}

/**
 * Step 2: the object must exist with the size that was declared and its first bytes must agree with the
 * type. Anything else is removed. Safe to call again: a capture already queued just comes back.
 */
export async function finalizeVoiceCapture(
  userId: string,
  id: string,
  options: { inline?: boolean } = {},
): Promise<VoiceCaptureDTO> {
  const storage = await requireVoice(userId);
  const row = await ownedRow(userId, id);
  if (row.status !== "UPLOADING") return toDTO(row);
  if (!row.storageKey) throw new AppError("NOT_FOUND");

  const reject = async (code: "UNSUPPORTED_FILE_TYPE" | "FILE_TOO_LARGE", message: string) => {
    await storage.delete(row.storageKey!).catch((error) => logger.warn("delete failed", { error }));
    await db.delete(voiceCaptures).where(eq(voiceCaptures.id, id));
    throw new AppError(code, message);
  };

  const head = await storage.head(row.storageKey);
  if (!head) throw new AppError("VALIDATION_ERROR", "The upload didn't arrive. Try again.");
  if (head.size > VOICE_MAX_BYTES) await reject("FILE_TOO_LARGE", "That recording is too long.");
  if (head.size !== row.sizeBytes)
    await reject("FILE_TOO_LARGE", "That recording was larger than it said.");
  const bytes = await storage.readHead(row.storageKey, Math.min(SNIFF_BYTES, head.size));
  if (!sniffAudio(bytes, row.mimeType)) {
    await reject("UNSUPPORTED_FILE_TYPE", "That isn't a recording this app can use.");
  }

  const [queued] = await db
    .update(voiceCaptures)
    .set({ status: "QUEUED", errorCode: null })
    .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.status, "UPLOADING")))
    .returning({ id: voiceCaptures.id });
  // Two finalizes at once: the second finds it already queued.
  if (queued) await queueAndRun(userId, id, options);
  return toDTO(await ownedRow(userId, id));
}

export async function getVoiceCapture(userId: string, id: string): Promise<VoiceCaptureDetail> {
  await requireVoice(userId);
  return toDetail(await ownedRow(userId, id));
}

/** Where the recording of a capture is, for the player in the review step. Only while it still exists. */
export async function voiceAudioLocation(
  userId: string,
  id: string,
): Promise<{ key: string; mime: string }> {
  await requireVoice(userId);
  const row = await ownedRow(userId, id);
  // Only a capture that is still being reviewed (or failed) has a recording worth playing.
  if (!row.storageKey || (row.status !== "READY" && row.status !== "FAILED")) {
    throw new AppError("NOT_FOUND");
  }
  return { key: row.storageKey, mime: row.mimeType };
}

/** The person's captures that are still in play, newest first. */
export async function listVoiceCaptures(userId: string): Promise<VoiceCaptureDTO[]> {
  await requireVoice(userId);
  const rows = await db
    .select()
    .from(voiceCaptures)
    .where(and(eq(voiceCaptures.userId, userId), inArray(voiceCaptures.status, PENDING_STATUSES)))
    .orderBy(desc(voiceCaptures.createdAt))
    .limit(50);
  return rows.map(toDTO);
}

/** Runs a failed capture again (feature 13 §7). Needs the recording, which is kept for a day. */
export async function retryVoiceCapture(
  userId: string,
  id: string,
  options: { inline?: boolean } = {},
): Promise<VoiceCaptureDTO> {
  await requireVoice(userId);
  const row = await ownedRow(userId, id);
  if (row.status !== "FAILED") return toDTO(row);
  if (!row.storageKey) {
    throw new AppError("VALIDATION_ERROR", "That recording is no longer kept. Record it again.");
  }
  const [queued] = await db
    .update(voiceCaptures)
    .set({ status: "QUEUED", errorCode: null })
    .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.status, "FAILED")))
    .returning({ id: voiceCaptures.id });
  if (queued) await queueAndRun(userId, id, options);
  return toDTO(await ownedRow(userId, id));
}

/**
 * Discard: the audio, the transcript and the row are removed. If storage refuses, the row stays as
 * `DISCARDED` with its text already cleared, and the hourly cleanup tries the object again.
 */
export async function discardVoiceCapture(userId: string, id: string): Promise<void> {
  // Discarding must work after AI is switched off, so only ownership is checked.
  const row = await ownedRow(userId, id);
  const storage = getStorage();
  if (row.storageKey && storage) {
    try {
      await storage.delete(row.storageKey);
    } catch (error) {
      logger.warn("could not delete a recording", { captureId: id, error });
      await db
        .update(voiceCaptures)
        .set({ status: "DISCARDED", transcript: null, parsed: null })
        .where(eq(voiceCaptures.id, id));
      return;
    }
  }
  await db
    .delete(voiceCaptures)
    .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.userId, userId)));
}

/** Removes one recording and forgets its key, but only when storage confirms. */
async function dropAudio(row: Pick<VoiceCapture, "id" | "storageKey">): Promise<boolean> {
  if (!row.storageKey) return true;
  const storage = getStorage();
  if (!storage) return false;
  try {
    await storage.delete(row.storageKey);
  } catch (error) {
    logger.warn("could not delete a recording", { captureId: row.id, error });
    return false;
  }
  await db.update(voiceCaptures).set({ storageKey: null }).where(eq(voiceCaptures.id, row.id));
  return true;
}

export type CleanupResult = { audioRemoved: number; rowsRemoved: number; expiredUploads: number };

/**
 * `voice.cleanup` (hourly): enforces the retention rules (feature 13 §2). Recordings that are due go;
 * a capture that never became ready is marked failed when its recording goes; rows past seven days
 * go with their text. A recording that cannot be deleted keeps its row, so the next pass tries again.
 */
export async function cleanupVoice(now: Date = new Date()): Promise<CleanupResult> {
  const rows = await db
    .select()
    .from(voiceCaptures)
    .where(or(isNotNull(voiceCaptures.storageKey), lte(voiceCaptures.expiresAt, now)))
    .limit(500);

  let audioRemoved = 0;
  let rowsRemoved = 0;
  let expiredUploads = 0;
  for (const row of rows) {
    let audioGone = row.storageKey === null;
    if (row.storageKey && audioIsDue(row, now)) {
      if (await dropAudio(row)) {
        audioRemoved += 1;
        audioGone = true;
      } else continue;
      if (row.status === "UPLOADING" || row.status === "QUEUED" || row.status === "TRANSCRIBING") {
        // It never became ready: nothing left to retry, and no text to keep.
        expiredUploads += 1;
        await db
          .update(voiceCaptures)
          .set({ status: "FAILED", errorCode: "EXPIRED", transcript: null, parsed: null })
          .where(eq(voiceCaptures.id, row.id));
      }
    }
    if (rowIsDue(row, now)) {
      if (audioGone || (await dropAudio(row))) {
        await db.delete(voiceCaptures).where(eq(voiceCaptures.id, row.id));
        rowsRemoved += 1;
      }
    }
  }
  return { audioRemoved, rowsRemoved, expiredUploads };
}

export { voiceAvailableFor };
