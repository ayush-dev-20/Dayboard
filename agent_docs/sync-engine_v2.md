# Feature: Sync engine

**Phase:** V2 (feature 05)
**Status:** In progress. The protocol for tasks is built and tested end to end (device engine, push, pull, versions, change log, idempotency). Not built yet: todos, projects, tags, links, inbox and views in the protocol; note content and its conflicts; the conflict records and their UI; the status indicator, Settings → Sync and the triggers in the app; pruning of old log rows; the request rate limit.
**Date:** 2026-10-13

## What was built

- **Protocol** (ADR 0007): `POST /api/sync/push` applies a batch in order, one result per operation, and stores each final result under `(user, op id)`. `GET /api/sync/pull?cursor=` returns the newest change per entity after a cursor, with the entity read fresh (a permanently deleted task comes back as `DELETE`).
- **Idempotency:** a repeated op id returns the stored answer and changes nothing. The same op id with a different payload is refused. Only a hash of the payload is stored.
- **Versions and the change log:** tasks have `version` and `last_modified_by_device_id`. Every task mutation logs its write in the same transaction (`src/lib/sync/change-log.ts`). Migration `0011` is expand-only.
- **Device engine** (`src/lib/local/engine.ts`): sends the queue in batches (one change per task per batch, at most 50 and 900 KB), applies each result, then pulls. Refused changes are FAILED and hold back later changes to that task. Waiting changes are retried, and after 10 tries are FAILED. A dropped connection keeps everything waiting. Pushes and pulls take turns across tabs (Web Locks).
- **Scheduler** (`src/lib/local/scheduler.ts`): starts a run at start, after a local change (debounced 1 s), on retry, and every minute while visible. A failed run backs off 2, 4, 8 … 30 s with ±20% jitter.
- **Server-side version guard on pull:** a device applies a pulled row only if its version is newer, and skips any task it still has a change for.

## Why

Replaying through Server Actions (feature 04) cannot tell a retry from a new change, and gives no way to ask what changed elsewhere. The protocol gives every change a device-made id, a version, and a log to read after a cursor.

## What was deferred

- **Other entities** (todos, projects, tags, links, inbox, views) are not in the protocol yet. They have no change log entries. `tests/unit/sync-change-log-coverage.test.ts` lists them as gaps, and that list must shrink as each module is covered.
- **Note content and conflicts** (`NOTE_CONTENT`, edit against delete, the compare and keep-both flows): not built. Notes go offline in feature 04 slices (b) and (c).
- **Conflict records and the conflict UI, Settings → Sync, the status indicator** (the spec's §6): not built.
- **Triggers in the app:** the scheduler and engine exist, but no component starts them yet. Bootstrap is not run by the app either.
- **Pruning** change-log and operation rows (feature 08 worker). Until then a device whose cursor is older than the kept rows is not told to take a fresh snapshot.
- **Request rate limit** (120 pushes a minute): needs a per-request log.
- **Subtask ordering** has a test (the child waits for its parent), but no offline command creates subtasks yet.

## Deviations from the spec

- The device is passed through the request context, not as a mutation argument (ADR 0007 explains).
- The task mutations that run their own transactions write their record just after the change. Each is safe to repeat.
- The engine never sends `baseVersion` for tasks (last write wins). It is only needed for note content.
- The client's `own device` skip is not used: applying by version makes a repeat harmless.

## Related files

- `src/app/api/sync/push/route.ts`, `src/app/api/sync/pull/route.ts`: the endpoints.
- `src/lib/sync/operations.ts`: envelope and per-type payload checks (shared with the tests).
- `src/lib/sync/push.ts`: per-operation handling and results.
- `src/lib/sync/payload-hash.ts`: the fingerprint of a change.
- `src/lib/sync/change-log.ts`: versions, the change log and the request's device.
- `src/db/queries/sync.ts`: the snapshot, the entity mapper and the pull query.
- `src/db/schema/sync.ts`: `change_log` and `sync_operations`.
- `src/lib/local/engine.ts`, `transport.ts`, `scheduler.ts`: the device side.
- Tests: `tests/unit/sync-engine.test.ts`, `tests/unit/sync-change-log-coverage.test.ts`, `tests/integration/sync-protocol.test.ts`, `tests/integration/sync-engine-server.test.ts` (two devices and a second person, on the real routes).

## Hand-off notes

- To add an entity: give its mutations a `logXxxUpserts` call, remove its entries from `GAPS` in the coverage test, add its operation types to `src/lib/sync/operations.ts` and `push.ts`, and extend the pull query.
- A change made online (Server Action) is logged with no device. The device that made it skips nothing; it simply applies the newer version.
- Migrations apply to the test database with `DATABASE_URL=postgres://localhost:5432/dayboard_test pnpm db:migrate`. The dev database and Neon still need migration `0011` (ask first for Neon).
- Related: `local-persistence-and-offline_v2.md`, `pwa-shell-and-install_v2.md`, `docs/decisions/0006`, `0007`, `0014`.
