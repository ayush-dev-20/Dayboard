import { finalizeCapture, putAudio, requestIntent } from "./api";
import { deleteRecording, listRecordings, noteAttempt, type LocalRecording } from "./local-store";
import type { VoiceCaptureDTO } from "../types";

// Getting a recording from this device to the server and into the queue (V2 feature 13 §4, steps 1 and
// 2): intent, then a direct upload to storage, then finalize. Every step is safe to repeat, so a
// recording that was interrupted, or made offline, just runs again from the top.

export type SendOutcome =
  | { ok: true; capture: VoiceCaptureDTO }
  /** `retry`: worth trying again later (offline, a busy server). Otherwise the recording cannot be used. */
  | { ok: false; retry: boolean; code: string; message: string };

const PERMANENT = new Set([
  "AI_DISABLED",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
]);

export async function sendRecording(recording: LocalRecording): Promise<SendOutcome> {
  const intent = await requestIntent({
    id: recording.id,
    mimeType: recording.mimeType,
    sizeBytes: recording.sizeBytes,
    durationMs: recording.durationMs,
  });
  if (!intent.ok) {
    return {
      ok: false,
      retry: !PERMANENT.has(intent.code),
      code: intent.code,
      message: intent.message,
    };
  }
  // No upload URL means the server already has the audio: only the finalize may be missing.
  if (intent.data.upload) {
    const put = await putAudio(intent.data.upload, recording.blob);
    if (!put.ok) return { ok: false, retry: true, code: put.code, message: put.message };
  }
  const done = await finalizeCapture(recording.id);
  if (!done.ok) {
    // A finalize that says the file didn't arrive may have lost a race: try the whole thing again.
    const retry = !PERMANENT.has(done.code) && done.code !== "UNSUPPORTED_FILE_TYPE";
    return { ok: false, retry, code: done.code, message: done.message };
  }
  return { ok: true, capture: done.data.capture };
}

let flushing = false;

/**
 * Sends every recording waiting on this device, oldest first, one at a time. Called on start and when the
 * connection returns. A recording that is accepted is deleted from the device; one that can never be
 * accepted is dropped with a message; one that may work later stays. Returns what was sent.
 */
export async function flushRecordings(
  userId: string,
  handlers: {
    onSent?: (capture: VoiceCaptureDTO) => void;
    onDropped?: (recording: LocalRecording, message: string) => void;
  } = {},
): Promise<number> {
  if (flushing || (typeof navigator !== "undefined" && navigator.onLine === false)) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const recording of await listRecordings(userId)) {
      const outcome = await sendRecording(recording);
      if (outcome.ok) {
        await deleteRecording(userId, recording.id);
        sent += 1;
        handlers.onSent?.(outcome.capture);
      } else if (!outcome.retry) {
        await deleteRecording(userId, recording.id);
        handlers.onDropped?.(recording, outcome.message);
      } else {
        await noteAttempt(userId, recording.id, outcome.code);
        // Offline or the server is struggling: the rest would fail the same way.
        if (outcome.code === "NETWORK") break;
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
