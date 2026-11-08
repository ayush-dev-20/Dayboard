# 0029. Dictation uses the browser's speech recognition

**Status:** Accepted
**Date:** 2026-11-08
**Phase:** V2

## Context

The owner asked for a microphone wherever text is written (notes, the Journal, task descriptions, the Inbox) that turns speech into text in place, formatted properly. V2 feature 13 (voice capture) already records, transcribes with the AI provider and asks for a review before it creates anything, but it needs storage, an AI key and the person's switch, it is asynchronous, and it makes new items instead of writing into the text being edited.

## Decision

- **Live dictation with the browser's `SpeechRecognition`** (`webkitSpeechRecognition` in Chrome, Edge, Safari and Android). Nothing is stored and nothing goes through Dayboard's servers, so it needs no storage, key or AI quota and works in the installed apps. The button is not shown in a browser without it (Firefox).
- **Formatting is ours and pure** (`src/lib/dictation/format.ts`): capital letters at the start of a sentence, the pronoun I, one space between phrases, and the English spoken commands "comma", "period / full stop", "question mark", "exclamation mark / point", "colon", "semicolon", "new line" and "new paragraph" (a new list item inside a list). Other languages are left exactly as heard.
- **One hook** (`use-dictation.ts`) and two places that use it: the editor toolbar (every `RichTextEditor`: notes, Journal entries, task descriptions) and `DictationTextButton` for the plain capture boxes (quick capture, Today, Inbox). Only finished phrases are inserted; the words still being heard are shown, not typed.
- The voice-capture microphone stays as it is. In the capture boxes the two sit side by side: "Dictate" types into the box, "Record a voice capture" runs the review flow.

## Alternatives

- **Record, upload and transcribe with the AI provider for every dictation.** Better punctuation and any browser, but it needs the key and storage, spends the daily AI allowance, adds seconds of delay and is not live. It could be added later behind the same button for browsers without speech recognition.
- **A speech library or a hosted service.** A new dependency and a new place for private text to go, for no gain over the browser's engine here.

## Consequences

- **Where the audio goes is the browser's business.** Chrome and Edge send it to their vendor's speech service; Safari uses Apple's. Dayboard does not see it. The settings page should say so if a data notice for voice is ever added there (voice capture's notice only covers Gemini).
- Desktop Chrome does not add punctuation by itself, so a person either says the marks or edits afterwards. Android's recogniser adds its own, and the formatter leaves it alone.
- Spoken commands are applied to every English phrase, so "the trial period ends" becomes "The trial. Ends". This is the usual trade-off of dictation commands; there is no escape word yet.
- Tests use a fake recogniser (`e2e/dictation.spec.ts`), because headless Chrome has no speech engine. The real engine is only exercised by hand on a device.
