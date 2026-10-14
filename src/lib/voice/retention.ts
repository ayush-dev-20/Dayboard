import { VOICE_AUDIO_HOURS, VOICE_RETENTION_DAYS } from "./types";

// How long voice data lives (V2 feature 13 §2). Pure: the cleanup job and the tests share it.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** When the transcript and the parsed result must be gone, whatever happened. */
export const expiresAtFor = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + VOICE_RETENTION_DAYS * DAY_MS);

/**
 * Whether the recording itself should be deleted now. It is kept while the person may still need it
 * (to play it, keep it, or try again) for one day after the capture became ready or failed, and for
 * the upload itself for one day. Consumed and discarded captures never keep audio.
 */
export function audioIsDue(
  capture: { status: string; updatedAt: Date; createdAt: Date; expiresAt: Date },
  now: Date,
): boolean {
  if (capture.status === "CONSUMED" || capture.status === "DISCARDED") return true;
  if (now >= capture.expiresAt) return true;
  const since =
    capture.status === "READY" || capture.status === "FAILED"
      ? capture.updatedAt
      : capture.createdAt;
  return now.getTime() - since.getTime() >= VOICE_AUDIO_HOURS * HOUR_MS;
}

/** Whether the whole row (and its text) should be removed now. */
export const rowIsDue = (capture: { expiresAt: Date }, now: Date): boolean =>
  now >= capture.expiresAt;

/** "Deleted in 6 days" for the list; null once it is under a day away (the list says "today"). */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
}
