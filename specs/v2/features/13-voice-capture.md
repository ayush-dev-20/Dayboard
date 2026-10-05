# Feature 13 — Voice Capture

## 1. Scope

- **Record → Transcribe → Review → Create**, mobile-first
- Browser recording with permission handling, a level meter, a time limit and cancel
- **Offline recording**: the audio waits on the device and is processed when the network returns
- Transcription through the AI adapter (mock in tests), then **structured parsing** into a transcript, detected tasks or a note, due dates the person clearly said, people and project mentions, a suggested title
- A mandatory **review and confirm** step; nothing is created silently
- Audio and transcripts are **temporary** by default; the person can choose to keep the recording

Reuses: quick capture (`C`, `CaptureBox`) and the Inbox, feature 09's storage service (temporary prefix), feature 08 jobs, feature 05 commands (so confirmed items work offline-capable), the V1 AI gate, limits and `ai_usage`, `src/lib/dates/resolve.ts` (relative dates), the V1 tasks preview dialog patterns, feature 03's shortcuts.

Packages: none beyond the AI SDK already used. Provider choice in ADR 0012.

Source spec sections: product §10, §13, §2.1 row 8; technical §10, §13; project plan Phase 8.

---

## 2. Data model

### `voice_captures`

| Column | Notes |
|---|---|
| `id`, `user_id` | client-generated id, user cascade |
| `status` | `UPLOADING, QUEUED, TRANSCRIBING, READY, FAILED, CONSUMED, DISCARDED` |
| `storage_key` | text NULL: temporary audio object (`voice/{userId}/{id}/{random}`); cleared when deleted |
| `mime_type`, `size_bytes`, `duration_ms` | |
| `language` | text NULL (detected or `und`) |
| `transcript` | text NULL, **cleared when the capture is consumed or discarded, or after 7 days** |
| `parsed` | jsonb NULL: the structured result (§5), same retention as the transcript |
| `keep_audio` | boolean default false: set by the person in the review step |
| `error_code` | text NULL |
| `created_at`, `updated_at`, `expires_at` | `expires_at` = created + 7 days |

Index `(user_id, status, created_at)`. **Audio never goes through the main database** (technical §10): only metadata and short-lived text live here.

### Retention rules

| Data | Kept until |
|---|---|
| Audio object | deleted as soon as transcription succeeds, **unless** the person ticks **Keep the recording**: then it is converted into a normal attachment (feature 09) on the note they create |
| Transcript and parsed result | until the capture is consumed or discarded, or 7 days; the created items keep only what the person confirmed |
| Failed captures | audio retained for 24 h so the person can retry, then deleted |

A `voice.cleanup` job (hourly) enforces these.

### Local (Dexie)

`voiceBlobs` store: the recorded Blob and metadata while it has not been uploaded (offline or interrupted). It is deleted after a successful upload.

---

## 3. Recording

`VoiceRecorder` (client):

- `navigator.mediaDevices.getUserMedia({ audio: true })` requested **only after a tap**, never on page load. Denied or unavailable: a clear message with how to enable the microphone, and a text capture fallback. The microphone button is hidden when `MediaRecorder` is unsupported.
- `MediaRecorder` with the best supported type (`audio/webm;codecs=opus`, `audio/mp4` on Safari); chunks collected into a Blob; the stream is stopped as soon as recording ends (no lingering mic indicator).
- **Limits:** 5 minutes and 10 MB; the UI counts down in the last 30 seconds and stops itself. **Pause**, **Cancel** (discard, no upload), **Done**.
- A level meter (CSS transform on amplitude from an `AnalyserNode`) and an elapsed timer, with `prefers-reduced-motion` honoured (static bars with a numeric timer).
- Recording continues if the screen locks only where the browser allows; if interrupted, what was recorded is kept and offered.
- The recorder works offline (everything is local until upload).

**Entry points:** a microphone button in the capture box and the Inbox capture row; the mobile bottom nav's capture action (long-press to record); the PWA shortcut `/capture?voice=1` (feature 03 manifest) opens straight into the recorder; keyboard `V` from anywhere when not typing (documented in shortcuts).

---

## 4. Pipeline

```text
record -> (offline: store blob) -> upload intent -> upload to temp storage -> finalize
       -> enqueue transcription.process -> transcribe -> parse (structured) -> READY
       -> review -> confirm -> commands create items -> CONSUMED (text + audio cleared)
```

1. **Upload:** `POST /api/voice/captures` `{ id, mimeType, sizeBytes, durationMs }` creates the row and returns a presigned upload (storage service, temporary prefix, 15 min expiry). Size and type validated (audio types only, ≤ 10 MB). `POST /api/voice/captures/{id}/finalize` confirms the object and enqueues the job. Direct-to-storage; the web server never streams audio.
2. **Transcribe** (`transcription.process`, queue `ai`): reads the audio via the storage service, calls `AiProvider.transcribe` (ADR 0012: Gemini audio input through the existing Google provider, or a dedicated speech-to-text provider), stores the transcript. Counts as **one AI action** (the transcription and the parse together), against the V1 limits; a capture over the limit becomes `FAILED` with `RATE_LIMITED` and can be retried later.
3. **Parse** (same job, second call): the transcript goes into a `<data>` block with the VOICE prompt and returns a validated structure (§5). An invalid structure falls back to "one note with the transcript".
4. The client polls `GET /api/voice/captures/{id}` (or a 2 s interval, up to 90 s; tick-mode friendly) and shows progress: "Uploading", "Transcribing", "Preparing". Leaving the page keeps the capture; it reappears under **Voice captures** with its status.
5. **Latency path for tick-mode hosts:** if no worker is available (08), the finalize call runs the same handler inline with a 25-second budget; otherwise it queues.

---

## 5. Structured result

```ts
type VoiceParse = {
  transcript: string;
  language: string;
  suggestedNoteTitle: string | null;
  items: {
    kind: "TASK" | "TODO" | "NOTE";
    title: string;                 // ≤ 200
    body?: string;                 // for NOTE
    dueDate?: string;              // ISO date, only if clearly stated
    priority?: "LOW" | "MEDIUM" | "HIGH";   // only if clearly stated
    projectMention?: string;       // free text as spoken
    people?: string[];
    confidence: "high" | "medium" | "low";
  }[];
};
```

Server post-processing (never trusting the model):

- **Dates** are resolved with `src/lib/dates/resolve.ts` against the person's day and time zone ("tomorrow", "Friday", "next week"); a date is kept only if the phrase resolves unambiguously, otherwise dropped.
- **Project mentions** are matched to the person's **existing** projects by normalised name (exact, then close match above a threshold). A match becomes a suggestion `projectId`; no project is ever created from speech. People mentions are shown as text only (V2 has no contacts).
- Items are capped at 10; empty titles dropped; the full transcript is always kept as an option (create a note from it).
- **Never silent:** the result is only ever shown in the review step.

---

## 6. Review and confirm

The review screen (full-screen on phones, a dialog on desktop) shows:

- The **transcript** (editable text) with a play button for the recording while it exists.
- The **detected items** as an editable checklist (V1 preview pattern): kind selector (Task, Todo, Note), title, due date chip (only if detected), priority, project (with the matched project preselected and changeable), confidence shown as words ("Check this one" for low/medium), tick to include.
- **Create note from transcript** as an option, with the suggested title.
- **Keep the recording** checkbox (off by default; attaches the audio to the created note, or to the first task if no note).
- **High-impact guard:** items with a due date or a high priority show a small "Review" mark and are **unticked by default** when confidence is not high, so a misheard "Friday" never silently schedules something.
- Buttons: **Create N items** (disabled until at least one is ticked), **Discard**. Esc discards after a confirm if edits were made.

**Confirm** creates the items through the existing commands (offline-capable, client ids), writes one `audit_log` row (source `VOICE`, kinds and counts, no text), marks the capture `CONSUMED`, and clears the transcript, parsed result and audio (unless kept). A toast says what was created with **Undo** (deletes the created items in one step).

---

## 7. UI states and settings

- **Recorder states:** idle → asking permission → recording → paused → processing → ready; plus denied, unsupported and too-long messages.
- **Offline:** "Saved on this device. We'll transcribe it when you're back online." The capture shows in a **Voice captures** list (Inbox page section) with status. Cancel and delete work.
- **Failure:** "Couldn't transcribe that. Your recording is kept for a day. [Try again] [Discard]".
- **Voice captures list** (Inbox): pending and ready captures, each with age, duration, status and an action (Review, Retry, Discard). Auto-expiry shown ("Deleted in 6 days").
- **Settings → AI:** "Voice capture" switch (on by default when AI is available), the data notice ("Recordings are sent to <provider> to be transcribed and then deleted unless you keep them."), and the Gemini free-tier line when relevant. With AI off or no key, all voice UI is hidden.

---

## 8. Server contract

| Route | Purpose |
|---|---|
| `POST /api/voice/captures` | create intent (owner = session user), validates type and size, rate limit 10/min |
| `POST /api/voice/captures/{id}/finalize` | confirm upload, enqueue transcription |
| `GET /api/voice/captures/{id}` | status and, when `READY`, the parsed result (owner only) |
| `GET /api/voice/captures` | the person's pending and ready captures |
| `POST /api/voice/captures/{id}/retry` | re-run after a failure or limit |
| `DELETE /api/voice/captures/{id}` | discard: removes audio, transcript and the row |

The review's confirm is **client-side commands**, not a server endpoint that creates records from AI output. Errors use the typed codes (`AI_DISABLED`, `RATE_LIMITED`, `NOT_FOUND`, `VALIDATION_ERROR`, `UNSUPPORTED_FILE_TYPE`).

---

## 9. Security and privacy

- Audio is private in storage, short-lived, per-user prefixed, deleted after transcription unless kept; presigned URLs expire in 15 minutes.
- Transcripts are sensitive: stored only until consumed/discarded/7 days, never logged, never in `ai_usage`, never in the audit log.
- Ownership on every route; ids from the client are re-checked; a worker job re-derives the user from the row.
- Rate limits and size caps protect the AI budget; one capture is one AI action.
- The microphone is requested only on an explicit tap and released immediately after recording.

---

## 10. Tests

**Unit**
- Parse post-processing: date phrases resolve in the person's day (tomorrow, weekdays, "next week", ambiguous dropped), project matching (exact, close, none, never creates), caps, invalid structure fallback.
- Retention rules by status; expiry computation.
- Recorder state machine with a fake `MediaRecorder` (limits, pause, cancel, unsupported).
- Zod schema for the structure.

**Integration** (mock transcription and parse)
- Lifecycle: intent → upload (memory storage) → finalize → worker transcribes → `READY` with the fixture result → consume clears transcript and audio.
- Ownership: another person's capture id is `NOT_FOUND` on every route; storage keys are per user.
- Rate limit and `AI_DISABLED`; a failure leaves the audio for 24 h and the row `FAILED`; retry works.
- Cleanup job removes expired transcripts and audio; kept audio becomes an attachment on the note.
- No item exists before confirm: after `READY`, task/todo/note counts are unchanged.

**E2E** (Chromium with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`; mock transcription keyed by fixture)
1. Record a capture → "Transcribing" → review shows the transcript and items → untick one, edit a title → Create → exactly those items exist; Undo removes them.
2. The high-impact guard unticks a low-confidence dated item.
3. Offline recording shows "Saved on this device"; reconnect processes it once.
4. Microphone denied and unsupported states; text capture fallback.
5. Keep the recording attaches audio to the created note; default deletes it (storage empty).
6. Discard deletes everything; limit reached auto-stops.
7. Axe on the recorder and review; 360px; reduced motion.

**Manual:** real microphone on iOS Safari (installed PWA) and Android Chrome; audio format round trip with the real provider.

---

## 11. Definition of done

- [ ] A person can record a quick capture on a phone, see a transcript and detected items, edit them, and create tasks, todos or a note
- [ ] Nothing is created before the confirm step; low-confidence dated items start unticked
- [ ] Recording works offline and processes once after reconnect
- [ ] Audio never touches the main database; audio and transcripts are deleted as specified; keeping a recording is explicit
- [ ] Transcripts and audio are never logged; ownership is enforced everywhere
- [ ] With AI off or unsupported browsers, voice UI is hidden and the app is unchanged
- [ ] CI uses the mock provider and fake media; no paid calls
- [ ] ADR 0012 written before building (transcription provider)
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/voice-capture_v2.md` written and indexed

---

## 12. Out of scope (V2)

Streaming (live) transcription; wake words or hands-free modes; speaker identification; voice replies; recordings longer than 5 minutes; audio editing; creating contacts from mentioned people; transcribing uploaded audio attachments; on-device transcription.
