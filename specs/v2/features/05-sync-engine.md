# Feature 05 — Sync Engine

## 1. Scope

- A real **sync protocol**: push the operation queue, pull other devices' changes, reconcile
- **Idempotent** operation handling (a retried or duplicated operation has the effect of one)
- **Conflict detection and recoverable conflict records**, with a plain resolution UI
- Server-side **versioning, tombstones and a change log** for every syncable entity
- **Retry with backoff**, manual retry, and a quiet **sync status indicator**
- A **diagnostics screen** (Settings → Sync) for technical detail
- Replaces feature 04's minimal replay; the `operations` store shape does not change

Reuses: feature 04's `operations` store and commands, V1 mutation functions in `src/db/mutations/*` and their Zod schemas (the server applies operations through them), V1 note `version` / conflict behaviour.

Source spec sections: product §4 (sync queue, status indicator, retry, conflict handling), §5, §13; technical §4 (sync protocol, conflict strategy), §13, §14; project plan Phase 3; `../Agent.md` §4.

---

## 2. Data model

### Columns added to every syncable table

Syncable tables: `tasks`, `todos`, `notes`, `projects`, `tags`, `task_tags`, `note_tags`, `task_notes`, `inbox_items` (and, as they are added, `collection_views` in 06, `note_links` in 07 where it is not derived).

| Column | Type | Notes |
|---|---|---|
| `version` | integer NOT NULL default 1 | Bumped by the server on every write. `notes` already has it. |
| `last_modified_by_device_id` | uuid NULL | The device whose operation made the last change |
| `deleted_at` | timestamptz NULL | Already present on tasks, todos, notes, projects, inbox. Add to tags and link tables so removals sync as tombstones |
| `updated_at` | timestamptz | Server-set (already present) |

The migration backfills `version = 1` and is expand-only (nullable or defaulted), so the previous release keeps working (rollback rule).

### `sync_operations` (idempotency and audit of applied work)

| Column | Notes |
|---|---|
| `user_id`, `op_id` | PK `(user_id, op_id)`. `op_id` is the client's UUID v7 |
| `device_id` | uuid |
| `entity_type`, `entity_id` | text, uuid |
| `type` | operation type (`task.update`, …) |
| `status` | `APPLIED \| DUPLICATE_IGNORED \| REJECTED \| CONFLICT` |
| `result_version` | integer NULL |
| `error_code` | text NULL |
| `received_at`, `applied_at` | timestamptz |
| `payload_hash` | text. A retry with the same `op_id` but a different hash is rejected (`VALIDATION_ERROR`) |

Payloads themselves are **not** stored (privacy; they can contain note text). Retention 30 days, cleaned by a job (08).

### `change_log` (what pull reads)

| Column | Notes |
|---|---|
| `seq` | bigint identity PK (the cursor) |
| `user_id` | uuid |
| `entity_type`, `entity_id` | |
| `op` | `UPSERT \| DELETE` (DELETE only for permanent deletes; soft deletes are UPSERTs with `deleted_at`) |
| `version` | integer |
| `device_id` | uuid NULL (lets a device skip its own changes) |
| `changed_at` | timestamptz |

Index `(user_id, seq)`. Written by `recordChange()` inside **every** mutation function in `src/db/mutations/*` (one helper, one place), in the same transaction as the write. Retention: rows older than 30 days are pruned by a job (08); a device whose cursor is older than the oldest kept row does a fresh snapshot (feature 04).

### `sync_conflicts`

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `entity_type`, `entity_id` | |
| `kind` | `NOTE_CONTENT \| EDIT_VS_DELETE \| DELETE_VS_EDIT \| FIELD` |
| `base_version`, `server_version` | |
| `local_payload` | jsonb: the person's edited copy (note content or the changed fields). Needed so nothing is lost |
| `created_at`, `resolved_at`, `resolution` | `KEEP_MINE \| KEEP_SERVER \| KEEP_BOTH` |

Index `(user_id, resolved_at)`. Content stays until resolved plus 30 days.

### Local (Dexie)

`operations.status` gains `SENDING` handling and `ack`; `meta.lastPullCursor`; a `conflicts` store mirroring unresolved conflicts for offline display.

---

## 3. Protocol (ADR 0007)

All sync routes are Route Handlers under `src/app/api/sync/`, each starting with `requireUser()`, Zod validation, and owner scoping.

### Push: `POST /api/sync/push`

Request: `{ deviceId, appVersion, ops: Operation[] }` (max 50 ops, 1 MB total). Each operation:

```ts
type Operation = {
  opId: string;                 // UUID v7
  entityType: "task" | "todo" | "note" | "project" | "tag" | "link" | "inbox" | "view";
  entityId: string;
  type: string;                 // "task.update" ...
  clientTimestamp: string;      // ISO, informational only
  baseVersion: number | null;   // version the client edited from (null for create)
  payload: unknown;             // validated per type
  dependsOn?: { entityType: string; entityId: string }[];
};
```

For each operation, in order, **in its own transaction**:

1. Look up `(user_id, op_id)`. If found: return its stored result (`DUPLICATE_IGNORED`, `result_version`). If the `payload_hash` differs, reject.
2. Check dependencies: every `dependsOn` entity must exist for this user (created earlier in the batch or already on the server); otherwise `REJECTED` with retryable `DEPENDENCY_MISSING`.
3. Validate `payload` with the type's Zod schema (the same schema the online Server Action uses). Invalid → `REJECTED` `VALIDATION_ERROR` (permanent).
4. Check ownership of every referenced id (`NOT_FOUND` otherwise; never reveal that another person's id exists).
5. Apply with the existing mutation function (`applyOperation(userId, deviceId, op)` dispatches to `src/db/mutations/*`), which bumps `version`, sets `last_modified_by_device_id`, writes `change_log`, and rebuilds projections (`content_text`).
6. Conflict rules (§4). A conflict writes a `sync_conflicts` row and returns `CONFLICT`; the entity on the server is **unchanged**.
7. Record `sync_operations` and return `{ opId, status, version, entity? }`. `entity` is the new server row (so the client reconciles without a second call).

Response: `{ results: [...], serverTime }`. The batch never fails as a whole because one operation failed. Rate limit: 120 push requests per minute per user.

### Pull: `GET /api/sync/pull?cursor=&limit=`

Returns `{ changes: [{ entityType, entityId, op, version, entity? }], nextCursor, hasMore }` for `change_log.seq > cursor`, latest change per entity, entities fetched fresh (never trust the log for content), up to 500 per page, `no-store`. The device **skips changes made by its own `device_id`** only if it has already applied the acknowledgement.

**Overlap window.** Concurrent transactions can commit out of `seq` order, so a pull could skip a row that commits late. The client therefore re-reads from `cursor − 200` (rows) each time and applies changes idempotently by `(id, version)`: a change whose version is not newer than the local row is ignored.

### Reconcile (client)

For each acknowledged operation: mark `ACKED`, upsert the returned entity if it is not older than local state. For each pulled change: if the local row has a `PENDING` operation touching it, keep the local values until that operation is acknowledged (it will be re-based on the server version); otherwise replace. Tombstones remove rows from lists but keep them for Trash.

### Triggers

Sync runs: on app start, on `online`, when the tab becomes visible, after each local command (debounced 1 s), every 60 s while visible, and on manual retry. One replayer per browser (Web Locks, feature 04). Backoff: 2 s, 4 s, 8 s … 30 s with ±20% jitter, reset on success. After 10 consecutive failures of the same operation it becomes `FAILED` (needs attention) and later operations on **other** entities continue.

---

## 4. Conflict strategy

(`../02-technical-spec.md` §4; do not claim CRDT-grade collaboration.)

| Case | Rule |
|---|---|
| Scalar fields (title, status, priority, dates, project, emoji, tags set) | **Last write wins** by server receive order. The server applies the operation and bumps the version; no conflict record. |
| Task fields edited on two devices | Same: LWW per operation. Completion of an already completed task is a no-op. |
| **Note content** edited from a stale `baseVersion` | Do **not** merge. Create a `NOTE_CONTENT` conflict holding the person's copy; the server note is unchanged. |
| **Edited here, deleted there** (`EDIT_VS_DELETE`) | The edit is preserved as a conflict (its payload) and the item stays deleted until the person decides: "Restore with my changes", "Keep deleted". |
| **Deleted here, edited there** (`DELETE_VS_EDIT`) | The delete is not applied; a conflict is recorded; the item stays. |
| Reorder | LWW on `sort_order`; a collision is harmless. |
| Link rows (tag, task↔note) | Set semantics: add and remove are idempotent. |

Resolution (UI §6): **Keep mine** (re-submit with the server's current version as base), **Keep server** (discard mine, download it), **Keep both** (notes only: save my copy as a new note titled "<title> (my version)" next to the original). Nothing is deleted until the person chooses; the conflict content is retained.

---

## 5. Server module layout

```text
src/lib/sync/
  operations.ts       Operation type, Zod schemas per type, payload hashing
  apply.ts            applyOperation dispatcher -> src/db/mutations/*
  conflicts.ts        classification, conflict record creation, resolution
  change-log.ts       recordChange() helper (used by all mutations)
  pull.ts             pull query + paging
src/app/api/sync/{push,pull,snapshot,conflicts}/route.ts
src/client/sync/
  engine.ts           replayer, backoff, triggers, locks
  reconcile.ts        apply acks and pulled changes to Dexie
  status.ts           derived sync state for the UI
```

`applyOperation` adds **no new business logic**: it validates and calls the same mutation functions the Server Actions call. Server Actions stay for non-offline surfaces (Settings, AI).

---

## 6. UI

### Sync status indicator

In the top bar next to the offline indicator; quiet by default (DESIGN.md, product §13):

| State | Shows |
|---|---|
| Synced | nothing (or "Synced" for 2 s after catching up) |
| Syncing | small spinner + "Syncing…" (only if it takes more than 1 s) |
| Offline | dot + "Offline" (+ "· N changes waiting") |
| Needs attention | warning icon + "Sync needs attention" (failed operations or open conflicts) |

Click opens a popover: last sync time, changes waiting, **Retry now**, **Review conflicts** (if any), link to **Settings → Sync**. No technical terms.

### Conflicts

- A non-blocking banner on the affected note ("This note changed on another device. [Compare] [Keep mine] [Keep server]") reusing V1's banner pattern. **Compare** shows the two versions side by side (read-only text diff) and offers **Keep both**.
- A **Conflicts** list in Settings → Sync and a badge on the status popover. Resolving removes it everywhere.
- For edit-vs-delete: "This note was deleted on another device, but you edited it. [Restore with my changes] [Keep deleted]".

### Settings → Sync (diagnostics)

Technical details live here only: device id (copyable), last successful sync and last pull cursor, queue counts by status, a list of waiting or failed operations (type, entity title, age, attempts, last error), per-operation **Retry**, and **Discard** (with a confirm that first offers **Download unsent changes** as JSON). Also: unresolved conflicts, **Sync now**, and **Reset local data and download again** (disabled while changes are waiting unless they have been downloaded).

### Existing editors

The note save state ("Saved", "Saved on this device", "Not saved, retrying") derives from operation status. The V1 "Recover unsaved changes?" flow is replaced by the operation queue (unsent edits are never lost, they are simply still queued).

---

## 7. Rules and limits

- **Ownership:** every operation is checked per entity against the session user; operations naming someone else's id are `REJECTED` `NOT_FOUND` and never reveal existence.
- **Payload caps:** 200 KB note content (existing), 1 MB per push request, 50 operations.
- **Ordering:** operations for one entity apply in `clientTimestamp` then `opId` order; the client also sends them in order.
- **Clock skew:** client timestamps are informational. Server receive order decides LWW.
- **Tombstones:** soft-deleted rows stay for sync and Trash; permanent deletes write a `DELETE` change and are removed from devices on pull.
- **Versioning window:** `x-app-version` older than the supported window gets `APP_OUTDATED` (feature 03 shows the update banner).
- **Privacy:** logs record operation ids, types, statuses and timings, never payloads.
- **Observability** (technical §14): sync success and failure rate, average latency, queue depth per device (reported in push request metadata, counted not stored), conflicts created, `DEPENDENCY_MISSING` retries, pull lag.

---

## 8. Tests

**Unit**
- Client: replayer state machine (PENDING → SENDING → ACKED | FAILED | CONFLICT), backoff with jitter, coalescing, single-replayer lock, trigger debounce.
- Reconcile: pending local operation protects a row from being overwritten; newer version wins; tombstones; own-device changes.
- Server: operation Zod schemas per type; payload hash mismatch; dependency check; classification of conflicts per the table in §4; overlap-window dedupe by `(id, version)`.

**Integration** (real handlers and database)
- Duplicate `op_id` returns the stored result and changes nothing; same `op_id` with a different payload is rejected.
- Batch with a failing operation still applies the others.
- Out-of-order dependencies (subtask before parent) retry successfully once the parent arrives.
- LWW for scalar edits; stale `baseVersion` on note content creates a conflict and leaves the note unchanged; edit vs delete both directions preserve content.
- Pull returns changes after the cursor, skips nothing within the overlap window, includes tombstones; a device with an expired cursor is told to snapshot.
- Ownership: another person's ids are `NOT_FOUND`; changes by user A never appear in B's pull; conflicts are per user.
- `change_log` and `version` are written by every mutation function (a test enumerates `src/db/mutations/*` exports).

**E2E**
1. Offline create, edit, complete across tasks, todos and notes → reconnect → everything on the server once; a second device sees it.
2. Reload mid-sync and replay the same batch: no duplicates (idempotency).
3. Two contexts edit the same note offline → the later push gets a conflict banner; **Keep both** creates the copy; **Keep mine** and **Keep server** behave as described.
4. Delete on one device, edit on another: both orders preserve the edit.
5. Kill the network during a push: the operation stays queued and succeeds on retry.
6. A permanently failing operation shows "Sync needs attention", the diagnostics list, **Download unsent changes**, **Discard**.
7. The indicator shows Offline with a waiting count, Syncing, then clears.
8. Axe, 360px, reduced motion on the new UI.

---

## 9. Definition of done

- [ ] Offline changes reach the server after reconnect, exactly once
- [ ] Duplicate and retried operations are idempotent
- [ ] Conflicts are recorded, visible in plain language, and recoverable; no edit is ever discarded silently
- [ ] Changes from other devices arrive by pull; deletions propagate as tombstones
- [ ] The status indicator is quiet when synced and honest when not; technical detail is only in Settings → Sync
- [ ] Every mutation function writes versions and the change log (enforced by a test)
- [ ] ADR 0007 written before building the protocol
- [ ] The migration is expand-only, so a rollback to the previous release works
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/sync-engine_v2.md` written and indexed

---

## 10. Out of scope (V2)

Real-time collaboration and CRDT merging; live push of changes from the server (polling and focus pulls only; push notifications are 14); background sync while the app is closed; end-to-end encrypted sync; selective sync by project; merging non-overlapping edits inside one note.
