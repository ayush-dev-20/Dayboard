# Feature 04 — Local Persistence & Offline Editing

## 1. Scope

- A **local database** (IndexedDB through Dexie) holding the person's tasks, todos, notes, projects, tags and the links between them
- **Repositories** and **commands** so every primary action updates local state first and records a durable operation
- **Offline create, edit, complete and reschedule** for tasks, todos and notes (and project/tag assignment); offline **quick capture** into the Inbox
- A **bootstrap** that fills the local database after sign-in, and keeps it in step with what the server renders
- An **offline routing model** so the installed app opens and works without a network (ADR 0006)
- Safe handling of **sign-out, user switching, storage quota and multiple tabs**
- A minimal **replay** of queued operations through the existing Server Actions when the network returns (the real protocol is feature 05)

Reuses: V1 Server Actions and Zod schemas, `src/lib/tasks/*` (status, recurrence, grouping, ordering) as the single source of task logic, `src/lib/dates/*`, the shared components (`TaskRow`, `TodoRow`, `NoteCard`, `RichTextEditor`), `useAutosave`/`useNoteSync` (replaced for notes by a local-first hook), feature 03's shell.

Packages (V2 `Agent.md`): `dexie`, `@tanstack/react-query`. Optional: `dexie-react-hooks` (ADR if used; otherwise use Dexie's `liveQuery` with a small hook).

Source spec sections: product §4 (offline CRUD, completion/rescheduling), §5, §13; technical §2, §3; project plan Phase 2; `../Agent.md` §4.

---

## 2. Local database

Database name `dayboard-local-<userKey>` where `userKey` is a SHA-256 prefix of the user id (so a different person on the same browser never sees or reuses it). Schema version tracked with Dexie's versioning; migrations are additive.

| Store | Key | Fields (besides the server fields) | Indexes |
|---|---|---|---|
| `meta` | `key` | `deviceId`, `userId`, `bootstrappedAt`, `schemaVersion`, `lastPullCursor` (05) | — |
| `tasks` | `id` | all task columns, `serverVersion`, `localRevision` | `status`, `dueDate`, `projectId`, `parentTaskId`, `[deletedAt+updatedAt]` |
| `todos` | `id` | same pattern | `isComplete`, `dueDate`, `projectId` |
| `notes` | `id` | note meta without body (`title`, `emoji`, `projectId`, `snippet`, `updatedAt`, `archivedAt`, `deletedAt`, `serverVersion`) | `updatedAt`, `projectId` |
| `noteContent` | `noteId` | `contentJson`, `baseVersion`, `updatedAt` | — (kept apart so lists never load bodies) |
| `projects`, `tags` | `id` | as server | `status`, `normalizedName` |
| `taskTags`, `noteTags`, `taskNotes` | composite | link rows | both ids |
| `inbox` | `id` | captured text, status, `createdAt` | `status` |
| `operations` | `opId` | per product spec §5: `entityType`, `entityId`, `type`, `clientTimestamp`, `deviceId`, `payload`, `baseVersion`, `status` (`PENDING \| SENDING \| ACKED \| FAILED \| CONFLICT`), `attempts`, `lastError`, `ack` | `status`, `[entityType+entityId]`, `clientTimestamp` |
| `drafts` | `noteId` | replaces the V1 `localStorage` drafts (migrated on first run) | — |
| `uiState` | `key` | toggle open/closed (feature 01), sidebar open branches (07), last view per collection (06), recent items (10) | — |

Rows keep the server's field names so the same Zod schemas and DTO mappers apply. Soft-deleted rows stay (tombstones) so deletions sync.

**Client-generated ids.** `uuidv7()` (already isomorphic) creates ids offline. The create Server Actions gain an optional `id` input: the server validates it is a v7 UUID, not already used by anyone, then uses it. Idempotent replay (05) relies on this.

---

## 3. Commands and repositories

Components never touch IndexedDB directly (technical §3). Layers:

```text
Component -> Command (src/client/commands/*) -> Repository (src/client/repos/*) -> Dexie
                         \-> enqueue(operation) -> operations store
```

- **Repository** functions are the only code that reads or writes Dexie tables: `tasksRepo.get/list/liveList/put`, `notesRepo`, etc. Reads are **live** (`liveQuery`), so every screen updates when local data changes, including from another tab.
- **Command** functions implement a primary action:
  1. validate the input with the same Zod schema as the Server Action (shared import);
  2. compute the new state with the **same pure logic** the server uses (`src/lib/tasks/status.ts` for completion, `recurrence.ts` for the next occurrence, `ordering.ts`) so offline and online results match;
  3. in one Dexie transaction: write the changed rows and append an `operations` row (`PENDING`);
  4. return immediately; the UI updates from the live query;
  5. wake the replay (below).
- **Operation types introduced here** (payload = the command input): `task.create`, `task.update`, `task.complete`, `task.reopen`, `task.reschedule`, `task.delete`, `task.restore`, `task.archive`, `task.reorder`, `todo.*` (same), `note.create`, `note.saveContent`, `note.saveTitle`, `note.meta`, `note.delete`, `note.restore`, `note.archive`, `project.assign`, `tag.set`, `taskNote.link`, `taskNote.unlink`, `inbox.capture`.
- **Coalescing:** repeated `note.saveContent` for the same note keep only the newest `PENDING` operation; repeated `task.update` on the same fields merge. The queue never grows with every keystroke.
- **Recurrence:** completing a repeating task offline creates the next occurrence locally with a client id and queues both operations in order.
- **Dependent ordering:** an operation that references an entity created offline (a subtask, a link, a project assignment) is queued after the create; replay preserves per-entity order.

### Notes

`useLocalNote(id)` replaces `useNoteSync` for notes: typing writes `noteContent` and the coalesced `note.saveContent` operation; the V1 save-state UI maps from operation status (`Saved` when ACKED, `Saved on this device` when PENDING offline, `Not saved, retrying` only for failures). The conflict banner and recover-draft flows move to feature 05; until then V1 behaviour (`baseVersion`) is preserved by sending `baseVersion` in the operation.

---

## 4. Bootstrap and freshness

- **First sign-in on a device (online):** `GET /api/sync/snapshot?cursor=` returns pages (default 500 rows, per entity type, ordered by id) of everything the user owns, including tombstones from the last 30 days, with each row's `version`. Notes arrive as meta first, then `noteContent` is fetched for notes **opened or edited recently (last 30 days) plus pinned/linked ones**, and the rest lazily on open ("download on demand" while online; offline-unavailable notes say "Open this note once while online to keep it available offline"). Progress shows quietly ("Getting your workspace ready…") and the app is usable as soon as tasks and Today are in.
- **Every online page load** still server-renders for fast first paint. The page passes its data to `seedFromServer(entity, rows)`, which upserts rows whose `version` is newer than the local copy and **never overwrites a row with a pending operation**. (Feature 05's pull replaces this with incremental changes.)
- **Staleness:** a local row with no pending operation is replaced by a newer server row; one with a pending operation keeps the local values until the operation is acknowledged.
- **Storage:** call `navigator.storage.persist()` after install or the third visit; read `navigator.storage.estimate()`. At 90% of quota, stop downloading note bodies for old notes and show a quiet warning in Settings → App ("Offline storage is almost full"). A failed write (QuotaExceeded) never loses the edit: the in-memory state and a minimal draft are kept and the person sees "Couldn't save on this device. Your changes are kept while this tab is open."

---

## 5. Offline routing model (ADR 0006)

Next's App Router needs the server for every navigation and Server Component render, so a plain cache cannot make the app work offline. Decision proposed here, to confirm in the ADR:

- Online, the app stays server-rendered exactly as in V1.
- A **local app** (`/offline/*` shell, a client-only React app) renders the **offline-capable screens** from Dexie using the same presentational components: Today, Tasks (list), Todos, Notes list, Note editor, Task detail (panel), Inbox with quick capture, Projects list (read-only), Search (local keyword), Settings → App.
- The service worker (03) answers a failed navigation to any of those paths with the local app shell, which reads the original path and renders the matching local screen. A small client router handles navigation inside it.
- When the connection returns, a quiet "Back online" message offers to **Continue**, which navigates to the server-rendered route.
- Screens that need the server (Settings account pages, AI surfaces, Trash restore of items not downloaded, Calendar, Files) show a friendly "Needs a connection" state in the local app.
- Components are shared: `TaskRow`, `NoteCard`, `TaskDetail` etc. take data props; the server routes pass server data, the local app passes live local data. No second copy of any component.

Alternatives (cache RSC payloads in the worker; convert every route to client components) are recorded in the ADR with why they were not chosen.

---

## 6. Sign-out, user switch, tabs

- **Sign-out:** if the `operations` store has `PENDING`, `SENDING`, `FAILED` or `CONFLICT` rows, confirm first: "You have N changes that haven't synced. Signing out will remove them from this device. [Stay signed in] [Sign out and discard]". With no pending operations, sign out clears the whole database silently. Always also clear feature 03's caches.
- **User switch / account deletion:** the database is per user key; a different user id starts a new database and the old one is deleted.
- **Multiple tabs:** Dexie live queries and a `BroadcastChannel("dayboard-local")` keep tabs in step. Only **one tab replays** operations at a time (Web Locks `navigator.locks.request("dayboard-replay")`, with a fallback timestamp lease where Web Locks is missing).
- **Storage cleared by the browser:** if the database is missing on a signed-in session, bootstrap again; any lost pending operations are reported on next load ("Some changes made on this device could not be recovered").

---

## 7. Minimal replay (until feature 05)

When online, a single replayer takes `PENDING` operations in order and calls the matching **existing** Server Action with the operation payload (plus the client id). On success it marks `ACKED` and upserts the returned row; on a network error it backs off (2 s, 4 s, 8 s … 30 s) and retries; on a validation or `NOT_FOUND` error it marks `FAILED` and surfaces a quiet "Some changes couldn't be saved" notice. Note saves use `baseVersion` as in V1 and a conflict marks the operation `CONFLICT` and shows the V1 conflict banner. No pull, no idempotency table and no change feed yet: feature 05 replaces this with the real protocol and keeps the `operations` shape so no data changes.

---

## 8. Server contract

New (read-only) route handlers under `src/app/api/sync/`:

| Route | Purpose |
|---|---|
| `GET /api/sync/snapshot?entity=&cursor=&limit=` | Paged snapshot for bootstrap. `requireUser()`, owner-scoped, `Cache-Control: no-store`. |
| `GET /api/sync/note-content?ids=` | Up to 20 note bodies per request for lazy download (owner-checked; unknown ids ignored). |

Changed: create actions (`createTask`, `createTodo`, `createNote`, `createProject`, `createTag`, `captureInboxItem`) accept an optional client `id`. No other server changes. Errors use the existing typed codes.

---

## 9. UI

- **Quiet offline indicator** (from 03): "Offline" in the top bar; when changes are waiting, "Offline · 3 changes saved on this device".
- **Row and editor states:** no per-row sync badges in this feature (05 adds the status popover). Notes show "Saved on this device" in the existing save-state slot.
- **Local app shell:** same chrome as the online app (sidebar, top bar, bottom nav); screens that cannot work offline show "Needs a connection".
- **Settings → App:** storage used and quota, "Offline data on this device" (counts), **Clear offline data** (disabled with a warning while changes are waiting).
- **First load:** a short, quiet "Getting your workspace ready…" with progress until Today and Tasks are available.

---

## 10. Tests

**Unit** (Vitest with `fake-indexeddb`)
- Repositories: CRUD, indexes, live queries re-emit on change.
- Commands use the shared pure logic: completing a repeating task offline gives the same next occurrence as `src/lib/tasks/recurrence.ts`; reorder keys match `ordering.ts`.
- Coalescing rules; per-entity ordering; dependency ordering (subtask after parent).
- `seedFromServer` never overwrites a row with a pending operation; newer server rows win otherwise.
- Quota error handling keeps the edit in memory.
- Per-user database isolation (`userKey`).

**Integration**
- Snapshot endpoint: owner scoping, paging, tombstones, no other user's rows; note-content endpoint ignores ids the person does not own.
- Create actions accept a client id once, reject a reused id (`CONFLICT`) and reject malformed ids.

**E2E** (`context.setOffline(true)`)
1. Install or load once online, go offline, reload: the local app opens; create a task, edit it, complete it, reschedule it; reload; everything is still there.
2. Edit a note offline, reload, content intact; go online: it appears on the server (replay) and a second context sees it.
3. Complete a repeating task offline: the next occurrence appears and syncs once.
4. Quick capture offline lands in the Inbox after reconnect, with no duplicate.
5. Sign out with waiting changes shows the warning; discarding clears the database.
6. Two tabs offline stay consistent; only one replays.
7. A note not downloaded shows "Open once while online" offline.
8. Different user on the same browser starts clean.
9. Axe on the offline indicator and local screens; works at 360px.

---

## 11. Definition of done

- [ ] Task creation, editing, completion and rescheduling work offline; note editing works offline; todos and quick capture work offline
- [ ] A refresh or restart never loses a local change
- [ ] Offline results (completion, recurrence, ordering) match the server's, because they use the same pure logic
- [ ] The installed app opens offline into a local app that renders the offline-capable screens
- [ ] Sign-out warns about waiting changes; per-user isolation holds; quota problems never lose an edit
- [ ] Only one tab replays at a time; no duplicate records after reconnect (client ids)
- [ ] Components are shared between server-rendered and local screens (no duplicate component)
- [ ] ADR 0006 written before building the routing model
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/local-persistence-and-offline_v2.md` written and indexed

---

## 12. Out of scope (V2)

The full sync protocol, pull of other devices' changes, idempotency tables and conflict records (05); offline AI, search index, calendar, uploads (their features); end-to-end encryption of the local database; offline access to Settings account pages; background sync while the app is closed.
