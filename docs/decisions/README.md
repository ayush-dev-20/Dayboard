# Architecture decisions (ADRs)

One short file per decision. Write one whenever you change the architecture or choose something different from a spec. Do it **before** you build it.

Filename: `NNNN-short-title.md` (for example `0001-use-better-auth.md`). Numbers go up and are never reused. Do not delete an old ADR; mark it **Superseded by NNNN** and write a new one.

## Index

| #                                                       | Title                                                                              | Status   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| [0001](0001-pin-typescript-6.md)                        | Pin TypeScript to the 6.0 line                                                     | Accepted |
| [0002](0002-self-host-emoji-data.md)                    | Serve emoji data from our own origin                                               | Accepted |
| [0003](0003-use-inter-everywhere.md)                    | Use Inter for all interface text                                                   | Accepted |
| [0004](0004-ai-provider-package.md)                     | Anthropic through the Vercel AI SDK, plus a mock                                   | Accepted |
| [0005](0005-modern-calm-ui-direction.md)                | Modern calm UI direction (Option B)                                                | Accepted |
| [0006](0006-offline-routing-local-app-shell.md)         | Offline routing: one precached local app shell for offline screens                 | Accepted |
| [0007](0007-sync-protocol-push-pull-change-log.md)      | Sync protocol: idempotent push, change-log pull, last write wins                   | Accepted |
| [0008](0008-drag-and-drop-library.md)                   | Drag and drop with dnd-kit (core and sortable)                                     | Accepted |
| [0009](0009-background-worker-and-tick-mode.md)         | Background jobs: database queue, worker process, and an authenticated tick         | Accepted |
| [0010](0010-object-storage-and-file-policy.md)          | Object storage (S3-compatible, Backblaze B2) and the file type policy              | Accepted |
| [0011](0011-semantic-search-embeddings-and-index.md)    | Semantic search: Gemini embeddings, pgvector, a scheduled indexing scan            | Proposed |
| [0012](0012-voice-transcription-with-gemini-audio.md)   | Voice capture: transcription with Gemini audio, and where it departs from the spec | Accepted |
| [0014](0014-service-worker-built-with-esbuild.md)       | Service worker written by hand and bundled with esbuild                            | Accepted |
| [0015](0015-assistant-floating-launcher-and-drag.md)    | The assistant's floating chat button, and dragging items onto it                   | Accepted |
| [0016](0016-assistant-threads-in-browser-storage.md)    | Assistant conversations in the browser's storage, until Dexie exists               | Accepted |
| [0026](0026-weekly-review-facts-and-suggestions.md)     | Weekly review: facts computed in code, suggestions checked against them            | Accepted |
| [0027](0027-tinted-chips-for-status-project-and-tag.md) | Tinted chips for status, project and tag                                           | Accepted |
| [0028](0028-expandable-dialog-for-peeking-at-a-note.md) | An expandable dialog for peeking at a note from Today                              | Accepted |

## Template

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD
**Phase:** V1 | V2 | V3

## Context

What problem or situation forced a decision? Include the relevant spec section.

## Decision

What we chose, in one or two sentences.

## Alternatives

Other options considered, and why they lost.

## Consequences

What gets easier, what gets harder, and what we must now watch for.
```
