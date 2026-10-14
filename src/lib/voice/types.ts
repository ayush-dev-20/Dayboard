// Shared names and shapes for voice capture (V2 feature 13). Safe to import from client code: no
// secrets, no server-only.

import type { VoiceConfidence, VoiceKind } from "@/lib/ai/schemas";
import type { VoiceCaptureStatus } from "@/db/schema/voice";

export type { VoiceConfidence, VoiceKind, VoiceCaptureStatus };

/** A recording stops by itself at 5 minutes or 10 MB, whichever comes first (feature 13 §3). */
export const VOICE_MAX_MS = 5 * 60 * 1000;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** The timer starts counting down this long before the limit. */
export const VOICE_COUNTDOWN_MS = 30 * 1000;
/** A recording shorter than this is treated as an accidental tap and thrown away. */
export const VOICE_MIN_MS = 800;

/** Transcript and parsed result are kept this long at most. */
export const VOICE_RETENTION_DAYS = 7;
/** Audio is kept this long once a capture is ready or failed, so it can be reviewed, kept or retried. */
export const VOICE_AUDIO_HOURS = 24;
/** At most this many new captures per person per minute. */
export const VOICE_INTENTS_PER_MINUTE = 10;
/** The presigned upload lives this long (feature 13 §9). */
export const VOICE_UPLOAD_EXPIRES_IN = 15 * 60;
/** Without a worker, finalize runs the job itself for at most this long (feature 13 §4.5). */
export const VOICE_INLINE_BUDGET_MS = 25_000;

export const VOICE_MAX_ITEMS = 10;

export type VoicePriority = "NONE" | "LOW" | "MEDIUM" | "HIGH";

/** One thing the person may create, after the server has checked it. Never the model's raw output. */
export type ReviewItem = {
  /** Position in the list; stable for the life of the capture. */
  id: string;
  kind: VoiceKind;
  title: string;
  /** For a note: its text. */
  body: string | null;
  /** "YYYY-MM-DD", kept only when the spoken phrase resolved to one date. */
  dueDate: string | null;
  priority: VoicePriority;
  /** An existing project of the person's, matched from what was said. Never created from speech. */
  projectId: string | null;
  /** What was said, shown next to the project so a wrong match is easy to see. */
  projectMention: string | null;
  /** Names that were spoken. Text only: there are no contacts. */
  people: string[];
  confidence: VoiceConfidence;
  /** A date or a high priority: a misheard word here would quietly schedule something. */
  highImpact: boolean;
};

export type ParsedCapture = {
  suggestedNoteTitle: string | null;
  items: ReviewItem[];
  /** True when the structure could not be read and the only item is the transcript as a note. */
  fallback: boolean;
};

/** A capture as the UI sees it. The transcript and the parsed result are included only for one capture. */
export type VoiceCaptureDTO = {
  id: string;
  status: VoiceCaptureStatus;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: string;
  expiresAt: string;
  keepAudio: boolean;
  /** A plain code such as `RATE_LIMITED` or `NO_SPEECH`, when the status is `FAILED`. */
  errorCode: string | null;
  /** Whether the recording still exists (it can be played and kept). */
  hasAudio: boolean;
  language: string | null;
};

export type VoiceCaptureDetail = VoiceCaptureDTO & {
  transcript: string | null;
  parsed: ParsedCapture | null;
};

export type VoiceIntentResult = {
  capture: VoiceCaptureDTO;
  /** Null when the capture has already been uploaded (a repeat of an intent). */
  upload: { url: string; headers: Record<string, string> } | null;
  expiresAt: string;
};

/** Statuses a capture can still move on from; the Inbox list shows these. */
export const PENDING_STATUSES: VoiceCaptureStatus[] = [
  "UPLOADING",
  "QUEUED",
  "TRANSCRIBING",
  "READY",
  "FAILED",
];

export const isWorking = (status: VoiceCaptureStatus) =>
  status === "UPLOADING" || status === "QUEUED" || status === "TRANSCRIBING";
