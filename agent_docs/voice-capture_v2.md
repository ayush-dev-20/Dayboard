# Feature: Voice capture

**Phase:** V2 (feature 13)
**Status:** In progress. The feature is complete and tested against the mock provider and the in-memory store, plus one real Gemini round trip with synthetic speech (see below). **Not run on a real phone**, and S3 `CopyObject` has not been run against Backblaze B2.
**Date:** 2026-10-14

## What was built

- **Record → transcribe → review → create.** A microphone in the Today capture box, the Inbox capture box and the quick capture box; the `V` key; "Record a voice capture" in ⌘K; and the installed app's "Quick capture" shortcut, which now opens `/capture?voice=1`. One dialog (full-screen below 768px) walks the whole path. The recorder (`src/lib/voice/recorder.ts`) is a plain state machine around `MediaRecorder`: five-minute and 10 MB limits, pause, cancel, a level meter, the microphone released the moment it ends, interruption keeps what was recorded.
- **Server** (`src/lib/voice/`): `POST /api/voice/captures` (intent: type, size, length, 10 a minute) → direct upload to storage under `voice/{userId}/{id}/{random}` → `POST …/{id}/finalize` (size and first-bytes check, queue `transcription.process` on queue `ai`; with no live worker it runs the same handler inline for up to 25 s) → transcribe, then parse → `READY`. `GET`, `GET …/audio` (302 to a 60 s signed URL), `retry`, `DELETE`. Nothing creates a task, todo or note before the person confirms.
- **Parse** (`parse.ts`, pure): the model's answer is never trusted. Dates go through `resolveDuePhrase` against the person's day (unresolvable and past dates are dropped); a spoken project matches only an existing one (exact after normalising, then a close match that is clearly the best); at most ten items; unusable output becomes one note holding the transcript.
- **Review** (`review-panel.tsx`): editable transcript, player, a row per item (tick, title, Task/Todo/Note, date, priority, project, "Check this one", a "Review" mark), "Also create a note from the transcript", "Keep the recording". An item with a date or high priority that the model was unsure of starts **unticked**. Closing an unedited review keeps the capture for later; closing an edited one asks (Keep reviewing / Review later / Discard).
- **Confirm** (`confirm.ts`, server action `confirmVoice`): the reviewed items become real in one transaction through the usual mutations, one `audit_log` row (source `VOICE`, counts only), the capture `CONSUMED` with its words cleared and its recording deleted, or attached to the first note (else first task) when kept. Undo moves them to Trash.
- **Offline:** a recording made offline waits in its own Dexie database (`src/lib/voice/client/local-store.ts`, `voiceBlobs`) and is sent on reconnect, exactly once (the ids are device-made, every step is repeatable). The Inbox lists "Voice captures" (this device first), each with status, age, length, "Deleted in N days" and Review / Retry / Open / Discard.
- **Settings → AI → Voice capture** switch (`user_preferences.voice_capture_enabled`), with the data notice and the Gemini free-tier line. Everything is hidden when AI is off, the provider cannot take audio (Anthropic), storage is not configured, or the browser has no `MediaRecorder`.
- **Retention** (hourly `voice.cleanup`, seeded by migration `0016`): audio goes at confirm or discard, one day after a capture is ready or failed, or one day after an upload that never finished; the row and its text go at seven days. A recording that cannot be deleted keeps its row so the next pass retries.
- **ADR 0012** records the provider choice and every place this departs from the spec.

## Why

Speaking is the fastest way to capture on a phone, and a wrong guess about a date must never schedule something quietly, so everything goes through a review step and the risky items start unticked. The model is a reader, not an author: the server decides what a date, a project and a list length are. The transcription is background work (`TRANSCRIBE`, not counted) and the parse is the one counted AI action, so a capture costs one action against the daily limit.

## What was deferred

- **Not tried for real:** iOS Safari (installed app) and Android Chrome microphones, recordings near five minutes, noisy or non-English speech, S3 `CopyObject` on Backblaze B2 (if it fails, "Keep the recording" says it could not keep it and the rest works). Verified once with the real API: five audio formats transcribed, and the app's own `transcribe` plus the parse worked for WebM (details in ADR 0012).
- **The mobile bottom-nav long-press.** The nav has no capture action to press (it is Today, Tasks, Notes, Inbox, More), so phones use the visible microphones, `V` and the installed shortcut. See ADR 0012.
- **Offline confirm.** Review needs the server, so there is nothing to confirm offline. Because of this the confirm is one server action, not device commands (ADR 0012).
- **A shortcut list.** There is no shortcuts help screen to add `V` to; it is in the ⌘K item and `app-shortcuts.tsx`.
- **Voice captures in the offline shell.** The recorder works offline once the page is loaded; opening it from a cold offline start was not tested.
- **Bucket lifecycle rule** on the `voice/` prefix as a second safety net: not set up (needs the bucket).

## Deviations from the spec

All in ADR 0012: audio is kept until the review ends (and at most one day after ready or failed) instead of being deleted at transcription, because the review plays it and can keep it; confirm is a server action; recordings use their own Dexie database; no long-press on the bottom nav; the "Quick capture" manifest shortcut now points at `/capture?voice=1`; `TRANSCRIBE` and `VOICE_PARSE` are two `ai_feature` values.

## Related files

- `src/db/schema/voice.ts`, migration `0016_voice-capture.sql` (two enum values, `voice_captures`, `voice_capture_enabled`, the `voice.cleanup` schedule).
- `src/lib/voice/`: `types.ts` (limits and shapes, client-safe), `parse.ts`, `retention.ts`, `summary.ts`, `recorder.ts`, `availability.ts`, `service.ts` (intent, finalize, retry, discard, cleanup), `process.ts` (the `transcription.process` work), `confirm.ts`, `keep.ts`, `handlers.ts`, `client/` (`api.ts`, `local-store.ts`, `upload.ts`, `sign-out.ts`).
- `src/lib/ai/`: `provider.ts` (`transcribe`, `supportsTranscription`), `providers/sdk.ts`, `providers/mock.ts`, `providers/mock-voice.ts`, `index.ts` (`transcribeAudio`, `isTranscriptionAvailable`), `schemas.ts` (`voiceParseSchema`), `prompts.ts`, `usage.ts` (`TRANSCRIBE` is not counted).
- `src/lib/storage/`: `keys.ts` (`createVoiceKey`), `types.ts` + `local.ts` + `s3.ts` (`read`, `copy`), `policy.ts` (`audio` category, `voiceMime`), `sniff.ts` (`sniffAudio`).
- `src/app/api/voice/captures/**`, `src/actions/voice.ts`, `src/app/(app)/capture/page.tsx`.
- `src/components/voice/`: `voice-provider.tsx` (state and polling), `voice-dialog.tsx`, `review-panel.tsx`, `voice-captures-list.tsx`, `mic-button.tsx`, `use-recorder.ts`, `use-voice-available.ts`, `level-meter.tsx`, `capture-launcher.tsx`; `settings/voice-settings.tsx`.
- Shared files touched (small edits): `(app)/layout.tsx`, `workspace-context.tsx`, `app-shell.tsx`, `app-shortcuts.tsx`, `command-menu.tsx`, `capture-box.tsx`, `today-capture.tsx`, `inbox-capture.tsx`, the inbox page, sign-out and account menu, `file-icon.tsx`, `manifest.ts`, `proxy.ts`, `robots.ts`, `builtin.ts`, `validations/settings.ts`, `preferences.ts`.
- Tests: `tests/unit/voice-pure.test.ts`, `voice-recorder.test.ts`, `voice-storage.test.ts`; `tests/integration/voice.test.ts` (35 cases); `e2e/voice.spec.ts` (22 cases, its own Playwright project with a fake microphone).

## Hand-off notes

- **To use it** you need storage (`STORAGE_DRIVER`, feature 09) **and** the Gemini provider with a key. Without either, no voice UI shows. If your reverse proxy sends `Permissions-Policy: microphone=()`, recording is blocked: spec 16 says it must be `microphone=(self)`. There is no Caddyfile in this repo to change.
- **Migration `0016`** is applied to the **test** database only. Dev and Neon still need it (ask before Neon).
- **The mock** reads its transcript out of the recording's bytes: a test uploads a WebM start (`1a 45 df a3`) followed by `mock-transcript:` and the words. Any other recording (the fake microphone in E2E) reads as a fixed sentence. `[mock:error]` in the words fails the transcription; `[mock:parsefail]` fails only the parse (so the fallback note shows). Playwright has a `voice` project: Chromium with `--use-fake-device-for-media-stream`, a generated WAV, and the microphone permission already granted.
- **Gemini and schemas:** a list limit around items that have a list limit of their own made the real API answer "invalid argument". Keep nested-array schemas free of an outer `.max()` and trim on the server (see `voiceParseSchema`).
- **Rate limits in tests:** one capture is one counted AI action and ten recordings a minute are allowed; a long test file for one person reaches both, so the integration helper clears the person's `ai_usage` and ages their earlier captures first.
- **Fixed on the way:** `staleAccounts` in `src/lib/calendar/store.ts` (feature 12) put a raw `Date` into a `sql` template, which the driver refuses, so "refresh the calendar when Today opens" failed on every request (the error only showed in the server log, inside `after()`). It now uses `lt`/`isNull`, with a test. The same mistake was caught in `processCapture` while building this: do not interpolate a `Date` into `sql`; use the operators.
- Related: `background-worker-and-jobs_v2.md` (queue `ai`, tick mode, inline path), `files-attachments-and-bookmarks_v2.md` (storage, attachments), `ai-assistant_v1.md` (limits, usage), `semantic-search_v2.md` (the same background-AI pattern), `google-calendar_v2.md`.
