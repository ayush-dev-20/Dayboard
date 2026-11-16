# 0019. Real-time collaboration: Yjs with Tiptap, a Hocuspocus service, projection into `notes`

**Status:** Accepted
**Date:** 2026-11-16
**Phase:** V3

## Context

V3 feature 05 lets two or more people edit one note at once, with names and cursors. The app is a Next.js monolith deployed on Vercel and Neon, where no process can stay alive to hold a WebSocket. The rest of the app (search, lists, backlinks, AI, exports) reads `notes.content_json` and `notes.content_text`, and notes are saved through a version check (`saveNoteContent`).

## Decision

- **Yjs with the Tiptap collaboration extensions** (`@tiptap/extension-collaboration`, `-collaboration-caret`, `@tiptap/y-tiptap`), pinned to the Tiptap version in use (3.31.4). Title and emoji live in a `Y.Map("meta")` in the same document.
- **Hocuspocus as the service** (`@hocuspocus/server`, `@hocuspocus/provider`, 4.8.0): a separate Node process built from this repository into the same image (`pnpm build:collab` → `dist/collab.mjs`, `node collab.mjs`), the way the background worker is. It is never run inside a Next.js request.
- **The app authorises, the service verifies.** `POST /api/collab/token` checks the person's access to the note (`resolveAccess`, feature 04) and returns a 60-second HMAC token with the user, the note and the role. The service checks the token on connect, makes `read` connections read-only, and re-checks access in the database on connect and every 60 seconds. A revoke calls the service's internal endpoint to drop connections at once.
- **A note is live only while someone other than the owner can edit it.** Otherwise it is saved exactly as today. While a live document exists for a note, the ordinary content, title and emoji saves are refused (`CONFLICT`), so an old tab cannot overwrite the shared text.
- **Seeding happens on the server, once,** under a per-note advisory lock, from `notes.content_json`. Clients never seed.
- **Projection back into `notes`.** After a quiet 2 seconds, and at most every 10 seconds while editing continues, the service converts the document to ProseMirror JSON, runs `sanitizeDoc`, and writes the note through the same pieces `saveNoteContent` uses (text, linked titles, `note_links`), with `version + 1` and `updated_by_user_id`. If conversion fails it keeps the last good projection.
- **Fallback.** With `COLLAB_URL` unset (the Vercel and Neon deployment), shared notes use the ordinary save-and-conflict flow. Live editing needs a host that runs Node continuously; which one is the owner's decision and needs no code change.
- **One instance.** No pub/sub or sticky routing here (feature 13).

## Alternatives

- **Operational transform or our own merge.** Years of edge cases; Yjs is the standard for ProseMirror.
- **Liveblocks, PartyKit or another hosted service.** Faster, but content leaves our database and a new vendor holds private notes.
- **A Hocuspocus extension inside Next.js.** Not possible on serverless, and a long-lived socket in a request handler would break deployments.
- **Writing every keystroke to `notes`.** Version bumps on every key and conflicts with the ordinary save path; projection in a quiet window keeps `notes` correct without that.

## Consequences

- Five new runtime packages (all MIT), loaded in the browser only for live notes.
- Two stores of the text for a live note (the Yjs state and `notes`), made consistent by the projector. The Yjs state is authoritative while the note is live; `notes` is authoritative otherwise.
- The editor needs a second save path (`useLiveNote`) and live-mode rules (no History extension, side effects only on the originating client).
- On Vercel and Neon, shared notes stay on the ordinary path until a long-lived host is added.
