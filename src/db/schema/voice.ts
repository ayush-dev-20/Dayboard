import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Relative imports: drizzle-kit loads this file without the `@/` alias.
import { user } from "./auth";

// Voice capture (V2 feature 13 §2, docs/decisions/0012). The audio lives in object storage under
// `voice/{userId}/{id}/{random}`; this row is the metadata and the permission. The transcript and the
// parsed result are private and short-lived: they are cleared when the capture is consumed or
// discarded, and after seven days. They are never logged.

export const VOICE_CAPTURE_STATUSES = [
  "UPLOADING",
  "QUEUED",
  "TRANSCRIBING",
  "READY",
  "FAILED",
  "CONSUMED",
  "DISCARDED",
] as const;
export type VoiceCaptureStatus = (typeof VOICE_CAPTURE_STATUSES)[number];

export const voiceCaptures = pgTable(
  "voice_captures",
  {
    // Made by the client (UUIDv7), so a recording made offline already has its id.
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("UPLOADING"),
    // Cleared when the object is deleted.
    storageKey: text("storage_key"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    // Detected by the model, or `und`.
    language: text("language"),
    transcript: text("transcript"),
    // The reviewed structure (`ParsedCapture`, src/lib/voice/types.ts), same retention as the transcript.
    parsed: jsonb("parsed"),
    keepAudio: boolean("keep_audio").notNull().default(false),
    // A plain code (`RATE_LIMITED`, `AI_PROVIDER_ERROR`, ...), never text from the recording.
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("voice_captures_user_status_idx").on(t.userId, t.status, t.createdAt),
    index("voice_captures_expires_idx").on(t.expiresAt),
    check(
      "voice_captures_status",
      sql`${t.status} in ('UPLOADING','QUEUED','TRANSCRIBING','READY','FAILED','CONSUMED','DISCARDED')`,
    ),
    check("voice_captures_size_positive", sql`${t.sizeBytes} > 0`),
    check("voice_captures_duration_range", sql`${t.durationMs} between 0 and 600000`),
  ],
);

export type VoiceCapture = typeof voiceCaptures.$inferSelect;
export type NewVoiceCapture = typeof voiceCaptures.$inferInsert;
