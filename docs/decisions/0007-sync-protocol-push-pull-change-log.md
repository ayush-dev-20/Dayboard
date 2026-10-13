# 0007. Sync protocol: idempotent push, change-log pull, last write wins for fields

**Status:** Accepted
**Date:** 2026-10-13
**Phase:** V2

## Context

V2 feature 05 (`specs/v2/features/05-sync-engine.md`) turns the offline queue of feature 04 into a real protocol. Devices send their queued changes, pull other devices' changes, and must never apply a change twice, lose an edit silently, or fight over note text. Feature 04 replays changes by calling the existing Server Actions, which cannot tell a retry from a new change, and which have no record of what another device changed.

## Decision

- **Push** (`POST /api/sync/push`): a batch of operations (up to 50, up to 1 MB), each with a device-made id (`opId`, UUID v7). Operations are applied in order, each in its own transaction, by the same mutation functions the Server Actions use. Every result is recorded in `sync_operations` under `(user_id, op_id)`.
- **Idempotency:** a repeated `opId` returns the stored result and changes nothing. The same `opId` with a different payload is rejected. Only a hash of the payload is stored, never the payload itself, so note text is not kept in the log.
- **Versions:** every syncable row carries a `version` the server bumps on every write, and `last_modified_by_device_id`.
- **Change log:** every write inserts a `change_log` row in the same transaction (`recordChange`), so a pull never misses a committed change.
- **Pull** (`GET /api/sync/pull`): the latest change per entity after a cursor, with the entity read fresh (the log says what changed, the table says what it is). The client re-reads a small overlap behind its cursor, and applies a change only if its version is newer than the local row. That covers transactions that commit out of order.
- **Conflicts:** scalar fields use last write wins by server receive order (no conflict record). Note content edited from a stale base version is not merged: it is recorded as a conflict and the server copy stays. Conflict records and their UI are a later slice (see the feature doc).
- **Retries:** the client backs off (2, 4, 8 … 30 s, ±20% jitter) and stops after ten failures of one operation. A permanent refusal (validation, not found) is final and holds back later changes to the same item.

## Alternatives

- **Replay through Server Actions only (feature 04).** Simple, but a retry after a lost answer creates a second copy, and there is no way to ask the server what changed since a point in time. Rejected.
- **CRDTs or operational transforms.** The product needs calm, predictable behaviour for personal data, not real-time merging. The spec puts that out of scope, and it would make note storage much harder. Rejected.
- **Database triggers for the version and the change log.** It would catch raw writes too, but it moves business rules out of the mutation code, and the device id would have to be passed through session settings. Rejected for now; the helper is called from each mutation, and a test lists every mutation that must call it.
- **Store full payloads for idempotency.** Easier to debug, but it keeps private note text in a second table. Rejected; the hash is enough to detect a changed retry.

## Consequences

- Each syncable table gains `version` and `last_modified_by_device_id` (expand-only, defaults, so the previous release keeps working).
- Every mutation function writes the change log through `logTaskUpserts` / `logTaskDeletes` (`src/lib/sync/change-log.ts`) in the same transaction. The device is not passed as an argument: the push endpoint sets it for the request (`withDevice`, an `AsyncLocalStorage`), and online use records no device. A test (`tests/unit/sync-change-log-coverage.test.ts`) lists every mutation that writes and fails when one does not log, except the gaps it names.
- The pull endpoint has to be paged and bounded. Old change-log rows are pruned by `maintenance.prune_sync` (feature 08), which records how far it pruned in `sync_retention`. A device whose cursor is below that floor is told `snapshotRequired` and takes a fresh snapshot (feature 04), so it never silently misses a deletion.
- The overlap window means a few changes are read twice; applying by version makes that harmless.
- **Deviations in the first slice (tasks only):** the push runs the task mutations in their own transactions (except create, which shares its transaction with its record), so the record is written just after the change. Each of those mutations is safe to repeat, so a crash in between only repeats the change. The request-level rate limit (120 pushes a minute) is not enforced yet: the repo has no per-request log to count against. The size and count caps (1 MB, 50 operations) are enforced.
- Related: `docs/decisions/0006-offline-routing-local-app-shell.md`, `docs/decisions/0014-service-worker-built-with-esbuild.md`.
