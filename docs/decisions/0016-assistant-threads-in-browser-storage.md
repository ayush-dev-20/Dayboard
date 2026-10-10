# 0016. Assistant conversations in the browser's storage, until Dexie exists

**Status:** Accepted
**Date:** 2026-10-09
**Phase:** V2

## Context

V2 feature 11 §3 keeps the assistant's conversations (messages, source cards, proposals, the items a chat is pointed at) **on the device only**, so Dayboard's servers store no prompts or answers, and says they live in **Dexie** (`assistantThreads`, `assistantMessages`). Dexie arrives with the offline features (03 to 05), which were skipped on purpose and are not built. `CLAUDE.md` says not to install it early.

## Decision

Conversations live in **`localStorage`**, one key per person (`dayboard:assistant:v1:{userId}`), behind a small interface (`src/components/assistant/threads.ts`: `createThread`, `updateThread`, `deleteThread`, `clearAllThreads`, `useThreads`, `useThread`). The privacy promise is unchanged: nothing is stored on the server, signing out removes every stored conversation of every person on the browser, "Clear all conversations" removes them, and another tab of the same browser follows through the `storage` event.

Limits keep it well inside the browser's quota: at most 30 threads and 100 messages per thread, and a full or blocked store drops the oldest thread and carries on in memory.

## Alternatives

- **Install Dexie now.** Against `CLAUDE.md`, and it would pull the offline foundation in early for one small store.
- **Raw IndexedDB.** More code for no gain at this size.
- **Server-stored threads.** Contradicts the spec's privacy rule.

## Consequences

- When Dexie lands, replace the body of `threads.ts` (same exports) and copy `localStorage` threads across once. Components do not change.
- `localStorage` is synchronous and about 5 MB: fine for text, wrong for anything large (attachments are never stored here).
- Threads do not follow the person to another device (as the spec says).
