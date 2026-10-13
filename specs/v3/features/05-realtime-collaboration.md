# Feature 05 — Real-time Collaboration on Notes (V3)

> **Build position: fifth V3 feature** (V3 plan phase 3). Depends on feature 04 (who may edit). Behaviour is in V3 product spec §8. Where this doc is more detailed, this doc wins for this feature.

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

- [ ] ADR 0019 written before building: Yjs with Tiptap, Hocuspocus as the service, seeding and projection, the fallback, the hosting limit
- [ ] A shared note is edited by two or more people at once with names and cursors; a viewer sees it read-only
- [ ] The note's ordinary columns stay correct: search, lists, exports, AI and non-live readers see the same content within a few seconds
- [ ] Reconnect never duplicates or loses edits; a test proves idempotence
- [ ] Revocation disconnects live sessions; tokens are short-lived and single-purpose
- [ ] Snapshots exist and are pruned; a note returns cleanly to ordinary editing
- [ ] Without the service, sharing still works through ordinary saves
- [ ] No content in logs; correlation id on every collaboration session
- [ ] Axe passes; announcements are polite and rare; reduced motion
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass; the Compose stack starts with the new service
- [ ] `agent_docs/realtime-collaboration_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 12. Out of scope (this feature)

- Real-time anything except note bodies, their title/emoji and presence: not tasks, todos, projects, canvases, tags, comment lists or settings.
- A version history UI or restoring a snapshot (snapshots are a safety net for now).
- Offline co-editing and merge of long offline sessions (V2 sync).
- Voice, video or chat; follow-the-cursor; suggestion or review mode.
- Collaboration on journal entries and templates (they are private); on canvases (needs its own decision).
- Horizontal scaling of the service (feature 13).
