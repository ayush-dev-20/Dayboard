# Feature 05 — Real-time Collaboration on Notes (V3)

> **Build position: fifth V3 feature** (V3 plan phase 3). Depends on feature 04 (who may edit). Behaviour is in V3 product spec §8. Where this doc is more detailed, this doc wins for this feature.

## 0. Reality check (2026-11-16)

Checked against the code and `agent_docs/` (notes, editor blocks, nested notes, files, sync and offline, background worker, PWA, permissions and sharing) before building. Every "Action" is the builder's proposal and can be vetoed; rows marked **(decision)** want the owner's yes before slice A.

| Spec says | What the project has | Action |
|---|---|---|
| "A separate collaboration service ... own container ... Caddy proxies `/collab` ... Compose service `collab`" | The deployed app is **Vercel + Neon** (no long-lived process). The repo has `Dockerfile` and a dev `docker-compose.yml` only: **no `docker-compose.prod.yml`, no Caddyfile** (the V1 production feature that adds them is not in the repo). Docker is not installed on the owner's Mac | **(decision)** Build the service as a second bundled entry of the same image (precedent: `build:migrate`, `build:worker`, `src/worker/index.ts`, ADR 0009), add a `collab` service to the dev and full-profile Compose, and run it in development with `pnpm collab`. **Live editing cannot work on the current Vercel + Neon deployment**; there `COLLAB_URL` stays unset and shared notes use the ordinary save-and-conflict flow (§2 fallback, already the spec's design). Picking a host that runs Node continuously is the owner's call and needs no code change |
| "`useAutosave` is off in live mode" | Notes do **not** use `useAutosave`. They use `useNoteSync` (`src/components/notes/use-note-sync.ts`, 346 lines) with a version check, conflict outcome, device draft (`lib/notes/draft.ts`) and the `save-state.ts` state machine (agent_docs: notes-projects-tags_v1) | Live mode replaces `useNoteSync` for that note: a second hook `useLiveNote` with its own status ("Live", "Reconnecting…"). The ordinary path is untouched |
| "History/undo extension off" | `createExtensions` uses `StarterKit.configure(...)` with undo/redo on (`src/components/editor/extensions.ts`) | `RichTextEditor` gets `collab`; with it, `StarterKit` `undoRedo: false` and the Collaboration extension's undo is used. The toolbar's Undo/Redo buttons must call the collaboration commands |
| Packages "`@tiptap/extension-collaboration` ... align them before installing" | `@tiptap/*` is pinned at **3.31.4**; `@tiptap/extension-collaboration@3.31.4` and `-caret@3.31.4` exist (peer: `@tiptap/y-tiptap ^3.0.7`, `yjs ^13`). Latest Hocuspocus is **4.8.0** (spec says 4.7), `yjs` 13.6.33, `y-protocols` 1.0.7 | Install the 3.31.4 extensions, `@tiptap/y-tiptap` 3.x, `yjs`, `y-protocols`, `@hocuspocus/server` and `@hocuspocus/provider` 4.8.0, exact versions pinned. **ADR 0019 first** (the spec names it; the folder skips 0019 to 0025, so 0019 is free) |
| "The service shares `src/db` and `src/modules/permissions`" | `src/modules/permissions/access.ts` starts with `import "server-only"`; the worker already bundles with `--conditions=react-server` so server-only modules load outside Next | Same esbuild flags for `build:collab`. `resolveAccess` is reused as is for the connect check and the 60-second re-check |
| "Projector writes `content_json`, `content_text`, `version + 1`, `updated_by_user_id` in one statement" | Saving a note is `saveNoteContent` (`db/mutations/notes.ts`): it also runs `forNoteKind`, `projectDoc` (text **and** linked-note titles) and `syncNoteLinks` (derived `note_links`, rebuilt in the same transaction, agent_docs: nested notes) | The projector **calls the same pieces** (a new `projectNoteFromLive(ownerId, noteId, doc, updatedBy)` next to `saveNoteContent`, no version check), so links, "Linked from" and search stay correct. A one-statement update would silently break backlinks |
| "In live mode `saveNoteTitle` and `updateNoteMeta` are refused for title and emoji" | Both actions exist (`actions/notes.ts`, `saveNoteContent` too) | Refuse **all three** while a `note_collab_docs` row exists (`CONFLICT` with a plain message; the editor reloads into live mode). Content must be refused too, or an old tab's ordinary save would overwrite the shared document at the next projection |
| "A note is live only while it has at least one grantee who can edit it" | Feature 04 has `resolveAccess` (person → role) but no reverse question "who may edit this note" | Add `noteEditors(noteId)` in `src/modules/permissions`: grants of role EDITOR on the note, a note above it, or its project; excludes Trash and journal entries. Used by the note page (`collab: { enabled, url }`) and by the service for the "last editor removed" rule |
| "Actions with side effects run only on the originating client" (`makeSubNote`, `fileDrop`) | `makeSubNote` (`blocks/note-create.ts`) calls `createSubNote` from the slash command and "New sub-note" only; the node view (`note-link-views.tsx`) has no create-on-mount effect. File upload placeholders are local node views (`file-views.tsx`, `file-insert.ts`) | Verified by reading; add a test (a remote update inserting a sub-note block creates no second note). Placeholders need a check that an unfinished upload node is never sent as a shared node |
| "Custom nodes ... attributes are JSON-serialisable (callout, toggle, tableOfContents, noteLink, subNote, image, file, bookmark, tables)" | All of those exist; toggle open state is per device in `localStorage` (not in the document), list markers are display only (editor-blocks hand-off) | Unit test over every node type: Yjs round trip equals `sanitizeDoc` output. Nothing to change for toggles |
| "Revoke calls the service's internal endpoint" | Feature 04's `removeShare`, `changeShareRole`, `revokeAllShares`, `leaveShare` and a note leaving a shared project (move) change access | Add one `dropCollabConnections(noteIds, userId?)` call (no-op when `COLLAB_URL` is unset) after each of those, plus the move path. The 60-second re-check is the backstop |
| "Search, lists, exports, AI keep working" | `content_text` feeds keyword search; semantic search and the assistant use a scan (ADR 0011), the sync engine does not cover notes yet (V2 feature 04/05 slices for notes are not built) | Projection keeps `content_text` fresh within 2 to 10 s. No sync work: offline note editing does not exist yet, so there is nothing to reconcile with |
| "Session with `requireUser()` on the token route" | Route handlers exist with `requireUser()`; `BETTER_AUTH_SECRET`-style secrets are in `env-schema.ts`; no rate limiting module for a new route | `POST /api/collab/token` with `requireAccess(..., "read")` (role edit only if `update` allowed); env `COLLAB_URL`, `COLLAB_TOKEN_SECRET`, `COLLAB_INTERNAL_SECRET`, `COLLAB_PORT` in `env-schema.ts` and `.env.example`; a production check that the secrets are set when `COLLAB_URL` is |
| "Names and avatars, colour from user id" | `UserAvatar` (`components/ui/user-avatar.tsx`) exists; `user.name` and `image` are in the session | Reuse `UserAvatar` for the header row; the cursor colour is a small pure function (unit tested) |
| "E2E: kill the service and bring it back" | Playwright has one `webServer` (`playwright.config.ts`) | Make it an array: the app and `pnpm collab` on a second port, with the app started with `COLLAB_URL`. A second app config without it covers the fallback test |
| "Bundle" | `scripts/check-client-bundle.mjs` budgets client JS; Yjs and the provider add weight | Load the provider, Yjs and the Collaboration extensions with a dynamic import **only when `collab.enabled`**, so ordinary notes pay nothing; run `check:bundle` |
| Snapshots, `note_snapshots`, a daily prune | The job system has `maintenance.*` handlers and a prune convention (background worker hand-off) | Add `maintenance.prune_note_snapshots` as a handler (it runs in tick mode too) |
| "Journal entries and templates are private; canvases need their own decision" | Journal entries are `notes` rows with `journal_date`; feature 04's `resolveAccess` already makes them unreachable by any grant | A journal entry is never live (it has no editors). Test it |
| Account deletion, scaling | Feature 12 and 13 are not built | `note_collab_docs` and `note_snapshots` cascade from `notes`, which cascade from the owner: deletion works. One instance only (as the spec says) |

**What already exists that we reuse (do NOT rebuild):** `RichTextEditor` and `createExtensions` (`components/editor/`), `sanitizeDoc` (`lib/editor/schema.ts`), `projectDoc` and `syncNoteLinks` (`db/mutations/note-links.ts`), `saveNoteContent`/`forNoteKind` (`db/mutations/notes.ts`), `resolveAccess` / `requireAccess` / `ownerFor` (`modules/permissions`), the note DTO and page (`app/(app)/notes/[id]`, `NoteEditor`), `lib/notes/draft.ts`, `UserAvatar`, `audit_log` (feature 04 added `SHARING`), the job handlers for pruning, the `build:worker` bundling recipe, `createWorker`'s signal handling as the model for the service's shutdown. **Dormant seam:** `notes.updated_by_user_id` (feature 04) is written by nothing but note saves; the projector is its second writer. `NoteDTO.breadcrumb` and the sidebar tree must keep working while a note is live (they read `notes`, which the projector keeps current).

**No existing collaboration code** (`grep -ri "yjs|hocuspocus|collab"` in `src`, `package.json`, `docs/decisions` finds nothing): everything here is new.

**Order of work (proposed), unchanged from §1:** A (ADR 0019, packages, service skeleton, token route, seeding, projection, editor with the extension, no presence), B (presence, read-only connections, revoke, title and emoji in the document), C (snapshots, reconnect hardening, limits, fallback, deployment files). Each slice leaves the app runnable with `COLLAB_URL` unset.

---

## 1. Scope

- **Live co-editing of a note's body** by everyone who may edit it, with each person's cursor and selection shown by name, and a small presence indicator.
- A separate **collaboration service** (a WebSocket server) running the same image as the web app, with its own container.
- **Persistence and snapshots** of the live document, projected back into the note's ordinary columns so search, lists, exports and AI keep working.
- **Reconnect** without losing or duplicating edits.
- A clean **fallback**: where the service is not running (for example the free serverless profile), shared notes still work with the existing save-and-conflict flow.

Real time is limited to **note bodies and their title/emoji**, and presence. Tasks, projects, canvases, comments lists and everything else are ordinary requests (`../Agent.md` §6).

Reuses: `RichTextEditor`, `sanitizeDoc`, the server text projection, feature 04's `requireAccess` / `resolveAccess`, the note page and its save-state UI, the device draft, `audit_log`.

Packages (ADR 0019 first; all MIT, checked with `npm view` on 2026-10-13): `yjs` (13.6), `@tiptap/extension-collaboration` and `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`, `@hocuspocus/server` and `@hocuspocus/provider` (4.7), `y-protocols`. **Use the Tiptap extension version that matches the installed Tiptap** (this repo pins `@tiptap/react` 3.31.4 while the latest extension is 3.32.0, and the extension pins `@tiptap/core` to its own version; align them before installing).

Source spec sections: V3 product §8, technical spec §3 and §11, DevOps spec §2 and §10, `../Agent.md` §6 and §10.

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | ADR, service skeleton, token route, seeding, persistence and projection, one editor with the collaboration extension, no presence | Two people see each other's text change |
| **B** | Presence (names, cursors, avatars), read-only connections, revoke handling, title and emoji in the shared document | It feels like a shared document |
| **C** | Snapshots, reconnect hardening, limits, metrics, fallback, deployment | Safe to leave on |

---

## 2. When a note is "live"

A note uses the live path **only while it has at least one grantee who can edit it** (through its own grant or its project's, feature 04). Otherwise it is saved by `useAutosave` exactly as today. The owner alone, or only viewers and commenters, is the ordinary path. The editor decides from `GET`-time data (`collab: { enabled, url }` on the note DTO, `enabled` false when `COLLAB_URL` is unset).

Viewers and commenters on a live note connect **read-only** and see changes as they happen.

---

## 3. Architecture

```text
Browser (Tiptap + Yjs provider) ──WebSocket──▶ Collaboration service (Hocuspocus)
        │                                              │
        │ POST /api/collab/token                       ├─ loads/saves the Y document (PostgreSQL)
        ▼                                              ├─ debounced projection to notes.* (PostgreSQL)
Next.js app (authz, signs the token) ◀──── secret ────┘  └─ snapshots (PostgreSQL)
```

- `src/collab/server.ts` is a small Node entry (`node dist/collab.js`) built from the same repository and image; it shares `src/db` and `src/modules/permissions`. It is a **separate process**, never inside a Next.js request.
- `POST /api/collab/token` (Route Handler, `requireUser()`): body `{ noteId }`; calls `requireAccess(…, "read")`; returns `{ token, role: "edit" | "read", url }`. The token is an HMAC-signed, **60-second** value holding `userId`, `noteId`, `role`, expiry (`COLLAB_TOKEN_SECRET`). Used once to open the socket.
- The service verifies the token on connect (`onAuthenticate`), sets the connection read-only for `read`, and **re-checks access against the database** on connect and every 60 seconds for the life of the connection. Feature 04's revoke calls the service's internal endpoint (`COLLAB_INTERNAL_SECRET`) to drop a person's connections at once; the 60-second re-check is the backstop.

---

## 4. Data model

### `note_collab_docs` (new)

| Column | Notes |
|---|---|
| `note_id` | uuid PK → notes, cascade |
| `ydoc` | bytea: the current Yjs state |
| `base_version` | integer: the `notes.version` the document was seeded from |
| `projected_version` | integer: the `notes.version` last written by the projector |
| `updated_at` | |

### `note_snapshots` (new)

`id`, `note_id` (cascade), `ydoc` bytea, `content_json` jsonb (the sanitised projection at that moment), `created_by` (nullable), `reason` (`INTERVAL`, `LAST_DISCONNECT`, `BEFORE_ROLLBACK`), `created_at`. Keep the last **30** per note; a daily prune removes older ones. Size cap per snapshot: 2 MB.

### `notes` (changed)

Nothing new. `content_json`, `content_text`, `version` and (feature 04) `updated_by_user_id` stay the source of truth for every non-live reader.

### Seeding and the projection

- **Seeding happens on the server, once.** When the first connection opens a note with no `note_collab_docs` row (or a stale one: `base_version` differs from `notes.version`), the service builds the Yjs document from `notes.content_json` **under a per-note advisory lock** and stores it. Clients never seed (the classic Yjs duplicate-content bug).
- **Projection:** after the last update in a quiet window (2 s) and at most every 10 s while edits continue, the service converts the Yjs document to ProseMirror JSON, runs `sanitizeDoc`, rebuilds `content_text`, writes `content_json` / `content_text` / `version + 1` / `updated_by_user_id` in one statement, and sets `projected_version`. If conversion or sanitising fails, it **keeps the last good projection** and logs the failure without content.
- **Going back to ordinary editing** (the last editor is removed, or `COLLAB_URL` is cleared): the service does a final projection, writes a `LAST_DISCONNECT` snapshot, and deletes the `note_collab_docs` row. The next live session re-seeds from the note.

### Title and emoji

They live in the shared document (a `Y.Map("meta")`), so everyone sees a rename live, and are projected with the body. In live mode `saveNoteTitle` and `updateNoteMeta` are refused for `title` and `emoji` (they go through the document), so an ordinary save cannot overwrite them. Tags, project and links remain ordinary actions.

---

## 5. Editor changes

- `RichTextEditor` gets a `collab` prop. With it: the History/undo extension is **off** and the Collaboration extension's own undo manager is used; `useAutosave` is **off** (the service persists); the initial content comes from the document, not props.
- Custom nodes must survive being edited by two people: their attributes are JSON-serialisable (checked for every node type: callout, toggle, tableOfContents, noteLink, subNote, image, file, bookmark, tables).
- **Actions with side effects run only on the originating client.** `makeSubNote` (which creates a note row) must not re-run when a remote update inserts a sub-note block; the block carries the created note's id in its attributes and nothing re-creates it. Same for file uploads in progress (`fileDrop`): the upload placeholder is local; only the finished `file`/`image` node is shared.
- The device draft still protects text when the connection drops (below).
- Nothing else about the note page changes: tags, project, linked tasks, Ask / Update with AI, copy, archive and Trash behave as before. **Update with AI** applies its edit as an ordinary transaction, which flows through the shared document.

---

## 6. Presence (slice B)

- Others' **cursors and selections** in the text, labelled with a name tag, from the Collaboration Caret extension; a name tag appears on activity and fades after 3 s idle.
- A row of up to 4 **avatars** (initials, a colour derived from the user id) in the note header, with "+N". It appears only while someone else is present and disappears when they leave. "Last edited by <name>, 2 minutes ago" shows under the title for shared notes.
- Colour is never the only signal: a person's name is in the tag and in the avatar's tooltip and accessible name.
- Status announcements are **polite, short and rare**: "Rahul joined" and "Rahul left" (debounced to one message per 5 s), and "Reconnecting…" / "Back online". Typing and cursor moves are never announced.
- Reduced motion: no cursor animation.

---

## 7. Reconnect and offline (slice C)

- The provider reconnects with backoff (1, 2, 4, 8, up to 30 s). While disconnected the editor stays editable, shows "Reconnecting… your changes are kept", and keeps edits in the in-memory Yjs document.
- **Idempotent by construction:** Yjs updates applied twice have no extra effect, so a replay after reconnect cannot duplicate text. A test proves it by sending the same update twice.
- If the tab is closed with unsent updates, a `beforeunload` warning appears and the editor writes a **device draft** of the document JSON (the existing note draft mechanism), offered back as "Recover unsent changes" on the next open (it is applied as a normal edit, never overwriting silently).
- Real offline editing is a V2 sync concern (features 04 and 05 of V2) and is not part of this feature; a collaborative note offline is read-only after the in-memory buffer limit (100 KB of updates) with a plain message.

---

## 8. Limits and safety

- 20 connections per note, 20 per person, updates ≤ 1 MB each, document state ≤ 2 MB (over it: the connection is read-only and shows "This note is too large to edit together. Remove some content."), 50 messages per second per connection. Abusers are disconnected, not queued.
- All stored content passes `sanitizeDoc` on projection; a forged Yjs update that adds a disallowed node cannot reach `content_json` or other readers.
- Tokens are single-purpose and 60 seconds long. The service never trusts a user id sent over the socket.
- No document text in logs, traces or metrics. Logs carry a **collaboration session id** (correlation id) and ids only (`../Agent.md` §10).
- The service has the same least-privilege database role as the app and no outbound network access except the database.

---

## 9. Deployment

- New Compose service `collab` (same image, command `node dist/collab.js`), port 1234, with a health route. Caddy proxies `/collab` with WebSocket upgrade.
- Env: `COLLAB_URL` (public WebSocket URL, unset = feature off), `COLLAB_TOKEN_SECRET`, `COLLAB_INTERNAL_SECRET`, `COLLAB_PORT`.
- **The V2 free-hosting profile (Vercel and Neon) cannot run a long-lived WebSocket process.** Live editing needs a host that runs Node continuously (the Compose deployment, or a small container platform). The fallback in §2 keeps sharing usable without it. ADR 0019 records the host choice and the single-instance limit; scaling beyond one instance (shared pub/sub, sticky routing) is feature 13.
- Build adds `scripts/build-collab.mjs` (esbuild, as the service worker is built, ADR 0014).

---

## 10. Tests

**Unit**
- Projection: Yjs ↔ ProseMirror JSON round trip for every node type; a forged update with a forbidden node projects without it; failure keeps the last good projection.
- Token: sign/verify, expiry, wrong note, wrong secret, role claim; constant-time compare.
- Seeding is idempotent under the lock; stale `base_version` re-seeds.
- Presence colour and initials are stable per user id.

**Integration** (real database; Hocuspocus in-process)
- Two clients converge on concurrent edits (text, lists, tables, toggles); the projection appears in `notes` within the window; `content_text` and `version` update.
- Read-only connection: its updates are rejected; an editor's are accepted.
- Revoke: removing the grant disconnects the person within the re-check window and immediately via the internal endpoint; their later token request is `NOT_FOUND`.
- Reconnect: drop the socket, edit on both sides, reconnect: converged with no duplicated text; the same update sent twice has no extra effect.
- Last editor removed: final projection, snapshot, doc row deleted; a later session re-seeds correctly from the edited note.
- Sub-note block inserted by A does not create a second note on B.
- Limits: oversize update rejected; 21st connection refused; state over 2 MB turns read-only.
- Authz: stranger, viewer-as-writer, expired token, token for another note all rejected.

**E2E** (two browser contexts)
1. Owner shares a note with an editor; both type at the same time; both see both texts; names show in cursor tags.
2. A viewer sees changes live and cannot type.
3. Rename in one context appears in the other; revoke closes the second context's editing.
4. Kill the service and bring it back: the editor shows Reconnecting, then back online, with no lost or doubled text.
5. `COLLAB_URL` unset: a shared note falls back to ordinary autosave and the conflict banner.
6. Axe on the shared note header and presence, light and dark; polite announcements only; reduced motion.

---

## 11. Definition of done

- [x] ADR 0019 written before building: Yjs with Tiptap, Hocuspocus as the service, seeding and projection, the fallback, the hosting limit
- [x] A shared note is edited by two or more people at once with names and cursors; a viewer sees it read-only
- [x] The note's ordinary columns stay correct: search, lists, exports, AI and non-live readers see the same content within a few seconds
- [x] Reconnect never duplicates or loses edits; a test proves idempotence
- [x] Revocation disconnects live sessions; tokens are short-lived and single-purpose
- [x] Snapshots exist and are pruned; a note returns cleanly to ordinary editing
- [x] Without the service, sharing still works through ordinary saves
- [x] No content in logs; correlation id on every collaboration session
- [~] Announcements are polite and rare and reduced motion removes the tag fade; Axe on the presence row is not run
- [~] `lint`, `typecheck`, `test`, `test:integration` and `build` pass and `e2e/collab.spec.ts` passes (the full `test:e2e` suite was not re-run); the Compose stack was not started (Docker is not installed), `pnpm collab` and the bundled `dist/collab.mjs` were
- [x] `agent_docs/realtime-collaboration_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 12. Out of scope (this feature)

- Real-time anything except note bodies, their title/emoji and presence: not tasks, todos, projects, canvases, tags, comment lists or settings.
- A version history UI or restoring a snapshot (snapshots are a safety net for now).
- Offline co-editing and merge of long offline sessions (V2 sync).
- Voice, video or chat; follow-the-cursor; suggestion or review mode.
- Collaboration on journal entries and templates (they are private); on canvases (needs its own decision).
- Horizontal scaling of the service (feature 13).

---

## 13. As built (deviations from this document)

- **Hosting:** the service is built and works, but live editing needs a host that runs Node continuously. The current Vercel and Neon deployment cannot, so `COLLAB_URL` stays unset there and shared notes use ordinary saves (§2 fallback). Choosing a host is open.
- **`useNoteSync`, not `useAutosave`:** notes use `useNoteSync`; a live note swaps it for a live stand-in (`useLiveNote`), so every other part of the note page is unchanged.
- **Projection** reuses `saveNoteContent`'s pieces through `projectNoteFromLive` (text, linked titles, `note_links`) instead of one raw statement.
- **Ordinary saves are refused for content too** (not only title and emoji) while a live document exists and someone can edit; a stale row (nobody can edit, or the service is off) is deleted by the next ordinary save.
- **Packages:** Hocuspocus 4.8.0 (the spec says 4.7), the Tiptap extensions 3.31.4 to match the editor, `@tiptap/core` 3.31.4 added as a direct dependency (the extensions need it).
- **The service bundle** has no `react-server` condition (the editor schema needs real React); `server-only` and the browser's action stubs are replaced in `scripts/build-collab.mjs`.
- **Token role:** `read` also for commenters (comments are feature 06).
- **Fallback on first load:** if the service does not sync in 8 seconds the note falls back to ordinary saves.
- **Not built:** the 100 KB offline buffer limit, "Recover unsent changes", "Last edited by", metrics, the Caddy route (no Caddyfile in the repo), a message for the 2 MB limit, and three of the six E2E cases (service restart, `COLLAB_URL` unset, Axe on presence). The Compose service was written but not started.
