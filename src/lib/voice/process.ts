import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, voiceCaptures } from "@/db/schema";
import { generateStructured, getProvider, PROMPT_VERSIONS, transcribeAudio } from "@/lib/ai";
import { dataBlock, systemPrompts, todayLine, NO_SPEECH } from "@/lib/ai/prompts";
import { voiceParseSchema } from "@/lib/ai/schemas";
import { checkLimits } from "@/lib/ai/usage";
import { getUserToday } from "@/lib/dates/today";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getPreferences } from "@/lib/preferences";
import { getStorage } from "@/lib/storage";
import { finishParse, fallbackParse, type ProjectRef } from "./parse";
import { VOICE_MAX_BYTES, type ParsedCapture } from "./types";
import { voiceAvailableFor } from "./availability";

// Turning a recording into a transcript and a reviewable list (V2 feature 13 §4, steps 2 and 3).
// One capture is one AI action: the transcription is background work and the parse that follows is
// the counted action (see `usage.ts`). Nothing here creates a task, a todo or a note: the person does,
// in the review step. Neither the audio nor the words are ever logged.

/** A capture left "transcribing" for this long was dropped by a crashed run; another may take it. */
const STALE_MS = 3 * 60 * 1000;

export type ProcessOutcome = "READY" | "FAILED" | "SKIPPED" | "INTERRUPTED";

async function fail(id: string, code: string): Promise<ProcessOutcome> {
  await db
    .update(voiceCaptures)
    .set({ status: "FAILED", errorCode: code })
    .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.status, "TRANSCRIBING")));
  return "FAILED";
}

async function projectsOf(userId: string): Promise<ProjectRef[]> {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)));
}

/**
 * Runs one capture to `READY` or `FAILED`. Safe to call twice and from two places at once: the first
 * to move it from `QUEUED` to `TRANSCRIBING` does the work and the other leaves. Never throws for a
 * provider or limit problem: the outcome is in the row, and the review step shows it.
 */
export async function processCapture(
  userId: string,
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProcessOutcome> {
  const [claimed] = await db
    .update(voiceCaptures)
    .set({ status: "TRANSCRIBING" })
    .where(
      and(
        eq(voiceCaptures.id, id),
        eq(voiceCaptures.userId, userId),
        or(
          eq(voiceCaptures.status, "QUEUED"),
          and(
            eq(voiceCaptures.status, "TRANSCRIBING"),
            lt(voiceCaptures.updatedAt, new Date(Date.now() - STALE_MS)),
          ),
        ),
      ),
    )
    .returning();
  if (!claimed) return "SKIPPED";

  try {
    if (!(await voiceAvailableFor(userId))) return await fail(id, "AI_DISABLED");
    const prefs = await getPreferences(userId);
    const provider = getProvider();

    try {
      await checkLimits(userId, prefs.timezone, {
        feature: "VOICE_PARSE",
        provider: provider.id,
        model: provider.modelName("main"),
        promptVersion: PROMPT_VERSIONS.VOICE_PARSE,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "RATE_LIMITED") {
        return await fail(id, "RATE_LIMITED");
      }
      throw error;
    }

    const storage = getStorage();
    if (!storage || !claimed.storageKey) return await fail(id, "AUDIO_MISSING");
    let audio: { bytes: Uint8Array; mime: string } | null;
    try {
      audio = await storage.read(claimed.storageKey, VOICE_MAX_BYTES);
    } catch {
      return await fail(id, "FILE_TOO_LARGE");
    }
    if (!audio) return await fail(id, "AUDIO_MISSING");

    let transcript: string;
    try {
      const result = await transcribeAudio({
        userId,
        // The type the person's device named is what was checked at intent time; the object's own is not trusted.
        audio: { bytes: audio.bytes, mime: claimed.mimeType },
        signal: options.signal,
      });
      transcript = result.text.trim();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return await fail(id, error instanceof AppError ? error.code : "AI_PROVIDER_ERROR");
    }
    if (!transcript || transcript.toLowerCase() === NO_SPEECH) return await fail(id, "NO_SPEECH");

    const today = getUserToday({ timezone: prefs.timezone, startOfDay: prefs.startOfDay });
    let parsed: ParsedCapture;
    let language = "und";
    try {
      const output = await generateStructured({
        userId,
        feature: "VOICE_PARSE",
        tier: "main",
        system: systemPrompts.VOICE_PARSE,
        prompt: `${todayLine(today, prefs.timezone)}\n\n${dataBlock("transcript", transcript)}`,
        schema: voiceParseSchema,
        fixture: { transcript },
      });
      parsed = finishParse({ output, projects: await projectsOf(userId), today });
      language = output.language;
      // A reading with nothing in it is no better than the words: offer them as a note.
      if (parsed.items.length === 0) parsed = fallbackParse(transcript);
    } catch (error) {
      // The words were heard, so they are not lost: one note holding the transcript.
      logger.warn("voice parse fell back to a note", {
        captureId: id,
        code: error instanceof AppError ? error.code : "UNKNOWN",
      });
      parsed = fallbackParse(transcript);
    }

    const [ready] = await db
      .update(voiceCaptures)
      .set({ status: "READY", transcript, parsed, language, errorCode: null })
      .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.status, "TRANSCRIBING")))
      .returning({ id: voiceCaptures.id });
    return ready ? "READY" : "SKIPPED";
  } catch (error) {
    // Interrupted (shutdown, over the time limit) or an unexpected fault: hand it back so a later run takes it.
    await db
      .update(voiceCaptures)
      .set({ status: "QUEUED" })
      .where(and(eq(voiceCaptures.id, id), eq(voiceCaptures.status, "TRANSCRIBING")));
    if (options.signal?.aborted) return "INTERRUPTED";
    throw error;
  }
}
