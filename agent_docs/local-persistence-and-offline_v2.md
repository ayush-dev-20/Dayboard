# Feature: Local persistence and offline editing

**Phase:** V2 (feature 04)
**Status:** In progress. Slice (a) is built and tested at the data layer: the local database, task commands, the queue, bootstrap and replay. Not built yet: the offline screens and the routing (ADR 0006 is accepted, the `/local` shell is the next slice), todos, notes, quick capture, projects, tags, sign-out gating, user switching, tab locks, quota.
**Date:** 2026-10-13

## What was built

- **Local database** (Dexie 4.4.6, `src/lib/local/db.ts`): one database per person, named `dayboard-local-<16 hex of SHA-256(user id)>`. Stores: `tasks`, `operations`, `meta`.
- **Task commands** (`src/lib/local/commands/tasks.ts`): create, complete (a repeating task gets its next occurrence, dated as the server dates it), reopen, reschedule, rename. Each one checks input with the server's Zod schema, uses the same pure logic (`statusPatch`, `nextOccurrence`, `orderAtTop`), and writes the row and its operation in one transaction. Repeated edits to one task merge into one pending update.
- **Queue and replay** (`operations.ts`, `replay.ts`): operations run in the order they were made (`seq`). One replay at a time. A dropped connection leaves the rest waiting. A refused change marks that task's later changes failed too. A create the server already has counts as sent.
- **Bootstrap** (`bootstrap.ts`, `api.ts`): pages through `GET /api/sync/snapshot`, upserts rows that are newer and never overwrites a row with a change waiting, then removes local tasks the server no longer lists.
- **Server** (`src/app/api/sync/snapshot/route.ts`, `src/db/queries/sync.ts`): owner-scoped, paged by id, includes deletions from the last 30 days, `Cache-Control: no-store`. Entities: `tasks`, `preferences`.
- **Server changes:** `createTask` accepts an optional device id (UUID v7); `completeTask` accepts an optional next-occurrence id; a reused id gives `CONFLICT` (`src/db/mutations/reused-id.ts`).
- **Session hint** (`src/lib/local/session-hint.ts`, `src/components/layout/session-hint.tsx`): the signed-in page writes `{userId, expiresAt}`. `sessionState` reports `none`, `expired` or `active`. Local data is locked after expiry.
- **Decision:** `docs/decisions/0006-offline-routing-local-app-shell.md`.

## Why

Replay has to send the same change the offline screen showed, and the server must not create a second copy when a request is retried. So ids are made on the device, and both sides use the same pure logic for status, recurrence and ordering.

## What was deferred

- The offline screens and the routing in the service worker (ADR 0006 next slice): the worker still answers failed navigations with `/offline`.
- Todos, notes (`noteContent`, coalescing, drafts), quick capture, projects, tags, task links.
- Sign-out gating and clearing the database, user switching, tab locks (Web Locks), quota handling, Settings → App counts, "Back online".
- Completing a repeating task that has subtasks offline (refused; the server copies subtasks, the device does not yet).
- Priority is taken from the preferences fetched at bootstrap (not refreshed on each page load).

## Deviations from the spec

- **ACKED operations are deleted** when acknowledged. The spec keeps them; feature 05 adds history when it needs it.
- **No compound index on `[deletedAt+updatedAt]`:** `null` cannot be indexed in a compound key. `deletedAt` is indexed on its own.
- **Dates are ISO strings** in the local rows (as in the snapshot), and the operation's `deviceId` is a per-database id stored in `meta`.
- **No version column:** `updatedAt` decides which copy is newer. Feature 05 can add `serverVersion` as a new Dexie version.

## Related files

- `src/lib/local/db.ts`: the schema (version 1) and the per-person database.
- `src/lib/local/user-key.ts`: the database name; needs `crypto.subtle`, so it works on https and localhost only.
- `src/lib/local/commands/tasks.ts`: the offline commands.
- `src/lib/local/operations.ts`: the queue and merging.
- `src/lib/local/replay.ts`: replay through `TaskActions` (the real ones are in `src/lib/local/actions.ts`).
- `src/lib/local/bootstrap.ts`, `api.ts`: the bootstrap and its fetches.
- `src/lib/local/workspace.ts`: the entry point the UI will use (`openWorkspace`).
- `src/lib/sync/snapshot.ts`: the shared row and page types.
- `src/db/queries/sync.ts`, `src/app/api/sync/snapshot/route.ts`: the snapshot.
- Tests: `tests/unit/local-tasks.test.ts` (23 cases, real Dexie on fake IndexedDB), `tests/integration/offline-sync.test.ts` (10 cases on the real database).

## Hand-off notes

- The commands never call the server. The replay is the only path to the server, through the existing Server Actions. Only one replay runs at a time (`replayPending` joins a running one).
- A replay error that is thrown (no network) keeps the change PENDING. A returned error marks the change FAILED and holds back later changes to that task.
- The bootstrap removes local tasks the server does not list, but never a task with a change waiting.
- Related: `pwa-shell-and-install_v2.md` (the worker that will serve `/local`), `ai-workspace-assistant_v2.md`, `multiple-views_v2.md`, `nested-notes-links-sidebar-tree_v2.md`.
