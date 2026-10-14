# 0012. Voice capture: transcription with Gemini audio input, and where it departs from the spec

**Status:** Accepted. The Gemini calls were made once for real, with synthetic speech and the app's own provider code (see Consequences for what was and was not checked).
**Date:** 2026-10-14
**Phase:** V2

## Context

V2 feature 13 (`specs/v2/features/13-voice-capture.md`) turns a recording into a reviewed list of tasks, todos and notes. It needs a speech-to-text step, and the spec asks for this ADR before building: either Gemini audio input through the existing Google provider, or a dedicated speech-to-text service.

What the project already has: `@ai-sdk/google` is a dependency and Gemini is the free-tier provider; one `AIProvider` adapter with a mock; limits and `ai_usage`; jobs (queue `ai`, tick mode on Vercel); object storage with presigned uploads (feature 09). Anthropic's models take no audio.

Three places where the spec's text does not fit the code as it is:

1. The spec says audio is deleted as soon as transcription succeeds, **and** that the person can play the recording and tick "Keep the recording" in the review step. Both cannot be true: the review comes after the transcription.
2. The spec says the confirm step creates items with "existing client commands" (offline-capable). Only tasks have offline commands (feature 04); todos and notes do not, and the review needs the server anyway.
3. Storage keys are `u/{userId}/{yyyy}/{mm}/{attachmentId}/{hex}` and storage has no whole-object read or copy, which transcription and "keep" need. Feature 09's file types do not include audio.

## Decision

- **Transcribe with Gemini audio input** through the existing Google provider, inside `src/lib/ai/providers/sdk.ts` only: `AIProvider` gains `supportsTranscription` and `transcribe(audio, { signal })`. The audio goes as a file part to the **fast** tier (`gemini-3.5-flash-lite`, with the normal fallback list), with a system prompt that returns the words only (`[no speech]` when there are none). Anthropic reports `supportsTranscription: false`, so with that provider voice is hidden. The mock reads its transcript out of the bytes (`mock-transcript:` followed by the words), or answers a fixed sentence for any other recording.
- **A second call parses**: the transcript goes into a `<data>` block with a VOICE_PARSE prompt and the **main** tier returns `{ language, suggestedNoteTitle, items[] }` (Zod, one schema). The server never trusts it: dates are resolved with `resolveDuePhrase` against the person's day (past dates dropped), a project is matched only to the person's own by normalised name, items are capped at ten, titles clipped. If the structure is unusable, the whole transcript becomes one note.
- **One AI action per capture.** Two new `ai_feature` values: `TRANSCRIBE` (background, **not counted**, like `EMBED`) and `VOICE_PARSE` (the one counted action, which is also what `checkLimits` checks before any provider work). Both are recorded in `ai_usage` with no audio and no text.
- **Audio lives only in storage, under `voice/{userId}/{captureId}/{random}`**: `createVoiceKey`, and `KEY_PATTERN` widened to allow it. `StorageService` gains `read(key, maxBytes)` and `copy(from, to)` (S3 `CopyObject`; the local drivers copy their blob). Types are the five a browser records (`audio/webm`, `audio/mp4`, `audio/ogg`, plus `audio/mpeg` and `audio/wav`), checked by first bytes at finalize. They are **not** in `ALLOWED_TYPES`, so nobody can attach audio by hand; a kept recording is the only way one becomes an attachment (category `audio`, played inline).
- **Retention differs from the spec in one place.** The recording is kept until the person finishes the review (confirm or discard), and in any case for **one day** after it becomes ready or fails (it is also what "Try again" needs). It is not deleted at transcription. The transcript and parsed result still go at confirm, discard, or seven days. The settings notice says exactly this. The hourly `voice.cleanup` job (seeded in the migration) enforces it, and a capture whose recording could not be deleted keeps its row so the next pass tries again.
- **The confirm step is one server action**, not device commands: the reviewed items (the person's edits, validated with Zod, never the model's answer) become tasks, todos and notes in one transaction through the same mutations as everything else, with one `audit_log` row (source `VOICE`, counts only) and the capture marked consumed. This is the same shape as feature 11's "apply a proposal". Undo moves what was made to Trash.
- **Recordings made offline wait in their own Dexie database** (`dayboard-voice-<hash>`, table `voiceBlobs`), not in feature 04's `LocalDatabase`, so the two never share a version number and voice does not touch feature 04's files. Signing out deletes it after asking, if a recording is still waiting.
- **The mobile bottom nav has no long-press capture.** It has no capture action to press, and a long-press on a link competes with the browser's own menu. Phones get the microphone in the Today and Inbox capture boxes and the quick capture box, the `V` key, and the installed app's "Quick capture" shortcut, which now opens `/capture?voice=1` (the recorder when voice is on, the quick capture box when it is not).

## Alternatives

- **A dedicated speech-to-text service** (Whisper API, Deepgram, Google Speech-to-Text). More accurate on noisy or long audio and gives timestamps, but it is another key, another bill, another data processor, and Gemini already has a free tier and is already in the app. Rejected for V2; the adapter keeps the door open.
- **One multimodal call that transcribes and parses together.** Half the latency and cost, but the transcript the person edits and the structure would come from the same opaque step, and a parse failure would lose the words. Two calls make the fallback ("one note with the transcript") possible.
- **Delete the audio at transcription and drop "Keep the recording".** Simpler and more private, but it removes a feature the spec asks for and the playback in the review.
- **Client commands for confirm.** Would let tasks be created offline, but review needs the server (transcription is server-side), so nothing is gained, and todos and notes have no commands.
- **Reuse `u/…` keys for recordings.** No storage change, but recordings would be indistinguishable from attachments and could not carry a bucket lifecycle rule as a second safety net.

## Consequences

- **Checked against the real API (2026-10-14), with synthetic speech made by `say` and converted with `ffmpeg`:** WebM/Opus, Ogg/Opus, MP4/AAC, WAV and MP3 were all transcribed correctly by `gemini-3.5-flash-lite` (about 1.7 to 2.8 seconds for a six-second clip). The adapter's own `transcribe` then worked for WebM (the other formats were tried through the SDK directly, not through the adapter), and the parse call returned a valid structure whose dates resolved correctly.
- **Found on the way:** Gemini refused the parse schema ("invalid argument") while it had a list limit (`maxItems: 30`) around items that have a list limit of their own (`people`). Without the outer limit it works, so the schema has none and the server trims the list. Worth knowing for any later schema with nested arrays.
- **Not checked:** a real microphone on iOS Safari (installed app) and Android Chrome; recordings near five minutes; speech in noise or in another language; S3 `CopyObject` against Backblaze B2 (the unit test checks the request, not B2's answer; if it fails, "Keep the recording" reports that it could not keep it and everything else still works); the free tier's behaviour under load (it answered "high demand" and "quota" a few times while testing, which the fallback list and the retry button cover).
- Gemini's free tier may use what is sent to improve Google's products. Settings → AI says so next to the switch, and voice is off when AI is off.
- Migration `0016` adds the two enum values, `voice_captures`, `user_preferences.voice_capture_enabled` and the cleanup schedule.
- Audio can sit in storage for up to a day after review starts. A bucket lifecycle rule on the `voice/` prefix (delete after 2 days) is a sensible belt and braces; it is not required.
