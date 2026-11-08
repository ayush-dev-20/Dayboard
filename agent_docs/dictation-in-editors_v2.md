# Feature: Dictation in the editors and capture boxes

**Phase:** V2 (an addition to voice, feature 13)
**Status:** In progress. Built and tested with a **fake recogniser**. **Not tried with the real engine on a real Mac or Android device.**
**Date:** 2026-11-08

## What was built

- **A microphone in the editor toolbar** (`DictateButton` in `src/components/editor/toolbar.tsx`), the first button after "Insert block". It appears wherever `RichTextEditor` does: notes, Journal entries (they are notes) and task descriptions, on desktop and on the phone's keyboard bar. Click to start, click again to stop (label "Dictate" / "Stop dictating", `aria-pressed`). While it listens, the toolbar shows a pulsing dot and the words still being heard; screen readers hear "Dictating" once.
- **A microphone in the plain capture boxes** (`DictationTextButton`): quick capture (⌘K), Today's one-line box, the Inbox box. It sits beside the voice-capture mic where that exists ("Dictate" types into the box; "Record a voice capture" is the review flow, unchanged).
- **Formatting** (`src/lib/dictation/format.ts`, pure, 13 unit tests): capital letters at sentence starts and for I, one space between phrases, and English spoken commands: comma, period / full stop, question mark, exclamation mark / point, colon, semicolon, new line, new paragraph. In a list, "new paragraph" starts a new item (`splitListItem`). Other languages are left as heard (`speaksEnglish`).
- **The hook** (`use-dictation.ts`): browser `SpeechRecognition`, restarts after a pause (up to 2 silent restarts), one phrase per session on Android (its recogniser repeats words when continuous), stops when you leave. Errors become plain messages (`explainDictationError`): microphone blocked, none found, offline.

## Why

The owner wanted to speak into any text and have it written properly, where voice capture creates items after a review. The browser's recogniser is live, free, and needs no storage or key (ADR 0029).

## What was deferred

- **A server fallback** (record and transcribe with the AI provider) for browsers without speech recognition (Firefox). The seam is the hook: the same `onFinal(text)`.
- **An escape for spoken commands** (so "trial period" can be said), a per-person language setting (it uses the browser's language), and a settings note on where the audio goes.
- **Other places:** task and todo titles, comments and the Ask box do not have a mic. The title boxes are one-line `input`s that could use `DictationTextButton` with `singleLine`.
- Not tried on iOS (installed app), Safari or Firefox; Android and the Mac PWA only by the fake.

## Related files

- `src/lib/dictation/format.ts`, `src/lib/dictation/recognition.ts` (the typed browser API, `explainDictationError`).
- `src/components/editor/use-dictation.ts`, `src/components/editor/toolbar.tsx` (`DictateButton`), `src/components/voice/dictation-text-button.tsx`; wired in `command/capture-box.tsx`, `today/today-capture.tsx`, `inbox/inbox-capture.tsx`.
- Tests: `tests/unit/dictation-format.test.ts`; `e2e/dictation.spec.ts` (9).

## Hand-off notes

- **Chrome has both `SpeechRecognition` and `webkitSpeechRecognition`**; the app prefers the standard one. A test that fakes only the prefixed one is silently using the real engine (headless fails). Fake both.
- Insert text with a **text node**, not a string: `insertContent(" word")` reads the string as HTML and drops the leading space.
- The editor keeps listening if focus moves elsewhere; phrases still go to the editor's last cursor.
- Related: `voice-capture_v2.md`, `editor-blocks-and-lists_v2.md` (the toolbar), ADR 0029.
