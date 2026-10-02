# Feature 03 — Notes, Projects & Tags

## 1. Scope

- Notes: rich-text documents, reliable autosave, emoji, archive, soft delete and restore
- Task ↔ note linking (many-to-many)
- Projects: CRUD, status, colour token, project detail page with progress
- Project assignment for tasks, todos and notes (optional everywhere, so orphaned items are first-class)
- Tags: create, rename, delete, attach to tasks and notes, filter by tag

Reuses from feature 02: `RichTextEditor` (`document` variant), `useAutosave`, `EmojiPicker`, the projection and Tiptap schema helpers.

Source spec sections: product §6.6–6.8, §6.10; technical §5, §6, §12; UI/UX §12, §19; project plan Phases 3–5.

---

## 2. Data model

### `notes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `project_id` | uuid NULL FK → projects, `ON DELETE SET NULL` | |
| `title` | text NOT NULL default `''` | 0–300 chars. The UI shows "Untitled" when empty. |
| `emoji` | text NULL | |
| `content_json` | jsonb NOT NULL | Tiptap JSON, canonical |
| `content_text` | text NOT NULL default `''` | server-built projection |
| `version` | integer NOT NULL default 1 | optimistic concurrency, see §4 |
| `created_at`, `updated_at`, `archived_at`, `deleted_at` | timestamptz | |

Indexes: `(user_id, updated_at DESC)`, `(user_id, deleted_at)`, `(user_id, project_id)`.

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `name` | text NOT NULL | 1–100 chars |
| `description` | text NULL | plain text, ≤ 2,000 chars |
| `status` | enum `ACTIVE, ON_HOLD, COMPLETED, ARCHIVED` | default `ACTIVE` |
| `color` | enum token `slate, red, amber, green, teal, blue, violet, pink` | default `slate`. Maps to CSS variables, never raw hex. |
| `archived_at` | timestamptz NULL | set/cleared in sync with status `ARCHIVED` |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes: `(user_id, status)`, `(user_id, lower(name))`, `(user_id, deleted_at)`.

This feature's migration also adds the `project_id` FKs on `tasks` and `todos` (columns created in 02).

### `tags`, `task_tags`, `note_tags`

| Table | Columns | Constraints |
|---|---|---|
| `tags` | id, user_id, name, normalized_name, color (same token enum, nullable), created_at, updated_at | unique `(user_id, normalized_name)` |
| `task_tags` | task_id, tag_id, user_id, created_at | PK `(task_id, tag_id)`, cascades on both FKs |
| `note_tags` | note_id, tag_id, user_id, created_at | PK `(note_id, tag_id)`, cascades |

`normalized_name` = trimmed, lower-cased, internal whitespace collapsed. Display `name` keeps the user's casing. 1–40 chars. Todos can't have tags (product spec §6.10).

### `task_notes`

| Column | Notes |
|---|---|
| `task_id` | FK → tasks, cascade |
| `note_id` | FK → notes, cascade |
| `user_id` | FK → user (defense in depth, technical spec §5) |
| `created_at` | |

PK `(task_id, note_id)`, index `(note_id)`. On insert, the server verifies **both** the task and the note belong to the session user (technical spec §7.4).

---

## 3. Relationship rules

| Situation | Behavior |
|---|---|
| Assign an item to a project | Project must be the same user's, not deleted. Archived/completed projects are allowed (but not offered first in pickers). |
| Soft-delete a project | Only the project goes to Trash. Its tasks, todos and notes **stay active**, and while the project is in Trash they show as "No project" (queries join projects with `deleted_at IS NULL`). `project_id` is **not** cleared, so restoring the project brings the grouping back. The confirm dialog says: "The tasks and notes in it are kept." |
| Permanently delete a project | FK `SET NULL`. Items become orphaned. |
| Soft-delete a task or note | Its links and tag rows remain but are hidden. Restoring brings them back. |
| Permanently delete a task or note | Link and tag rows cascade away. |
| Delete a tag | Hard delete after confirmation (tags don't go to Trash). Associations cascade. |
| Subtask project | Always follows the parent. Changing the parent's project updates its subtasks in the same transaction. |

---

## 4. Note autosave and conflict handling

This must meet product spec §6.6: never lose already-confirmed local editor state.

1. `useAutosave` debounces changes (800 ms) and sends `saveNoteContent({ id, contentJson, baseVersion })`.
2. The server updates `WHERE id = :id AND user_id = :uid AND version = :baseVersion`, increments `version`, rebuilds `content_text`, and returns `{ version, updatedAt }`.
3. **Zero rows updated** means the note was changed elsewhere (another tab or device). The server returns `CONFLICT` with the latest version. The editor shows a non-blocking banner: "This note changed in another window. [Load latest] [Keep mine]". "Keep mine" re-saves with the new base version.
4. **Network or server failure:** the latest unsaved JSON is kept in memory and mirrored to `localStorage` (`draft:note:<id>`, try/catch). Status shows "Not saved, retrying". Retries back off (2s, 4s, 8s … max 30s) and also fire on the `online` event.
5. On editor load, if a local draft exists that is newer than the server's `updatedAt`, offer to restore it: "Recover unsaved changes?"
6. `beforeunload` warns only while a save is pending or failed.
7. Title saves use the same path (`saveNoteTitle`, debounced 500 ms, same version check).

Save-state UI: "Saving…" → "Saved" (fades after 2s) → "Not saved, retrying" in warning colour with an icon. No toasts for autosave (UI/UX §17).

---

## 5. Server contract

### Notes (`src/actions/notes.ts`)

| Action | Input | Notes |
|---|---|---|
| `createNote` | `{ title?, emoji?, projectId?, contentJson?, linkTaskId? }` | `linkTaskId` supports "New linked note" from task detail |
| `saveNoteContent` | `{ id, contentJson, baseVersion }` | §4 |
| `saveNoteTitle` | `{ id, title, baseVersion }` | |
| `updateNoteMeta` | `{ id, emoji?, projectId? }` | doesn't touch `version` |
| `archiveNote` / `unarchiveNote` / `deleteNote` / `restoreNote` / `permanentlyDeleteNote` | `{ id }` | |

### Links and tags

| Action | Input |
|---|---|
| `linkTaskNote` / `unlinkTaskNote` | `{ taskId, noteId }` |
| `createTag` | `{ name, color? }`. Returns the existing tag if the normalized name already exists (idempotent). |
| `renameTag` | `{ id, name }` → `CONFLICT` if the normalized name clashes |
| `setTagColor` / `deleteTag` | `{ id, … }` |
| `setTaskTags` / `setNoteTags` | `{ id, tagIds[] }` (replace the set in one transaction, max 10 tags per item) |

### Projects (`src/actions/projects.ts`)

`createProject`, `updateProject` (name, description, status, colour), `deleteProject`, `restoreProject`, `permanentlyDeleteProject`, `assignToProject({ itemType: "task" | "todo" | "note", itemId, projectId | null })`.

### Queries

- `listNotes(userId, { projectId?, tagId?, archived? })`: id, title, emoji, first ~160 chars of `content_text`, updated_at, project, tags. Never ships `content_json` in lists.
- `getNote(userId, id)`: full note + linked tasks (open first) + tags.
- `getProjectDetail(userId, id)`: project + open tasks + completed tasks (last 20) + open todos + notes + progress.
- **Progress** = completed ÷ (total − cancelled), counting top-level tasks and todos in the project (not archived, not deleted). A project with no items shows "No items yet" instead of 0%.

---

## 6. UI

### Notes

- `/notes`: list sorted by last updated. Each `NoteCard` row shows emoji, title, snippet, relative time, project token and tags. Filters for project and tag in the URL. Compact rows, not big cards (UI/UX §6).
- `/notes/new`: opens an empty editor. **The row is created on the first keystroke** in the title or body, so abandoned "new note" clicks leave no empty notes.
- `/notes/[id]`: full-page editor on every screen size (notes are documents; UI/UX §12). Header: back/breadcrumb (project if any), emoji + title, save state, "Linked tasks" button (opens a popover listing tasks and a "Link task" search), overflow (project, tags, archive, delete). Content width 700–850px.
- Editor toolbar: compact toolbar on desktop, horizontally scrollable bottom toolbar on mobile that sits above the on-screen keyboard. Bubble menu on text selection.
- `Shift+N` creates a new note from anywhere (when not typing).

### Task detail additions

- "Related notes" section: note chips (emoji + title) → click opens the note. "Link note" search picker. "New linked note".
- Tag combobox (type to search, Enter to create) and a project picker replace the feature 02 placeholder.

### Projects

- `/projects`: list grouped by status (Active, On hold, Completed; Archived collapsed). Each `ProjectCard` shows colour token, name, open task count and a progress bar with a text percentage.
- `/projects/[id]`: summary (editable name/description/status), progress, Open tasks (reuses `TaskList` + `TaskRow`), Open todos (`TodoRow`), Notes, Completed tasks (collapsed). Quick add for task, todo or note, all pre-assigned to this project.
- The project picker (used everywhere) lists active projects first, then on-hold, then others, and ends with "+ New project".

### Tags

- Managed in Settings → Tags (rename, colour, delete with usage count) and created inline from the tag combobox.
- `TagBadge`: name + optional colour dot. Colour is never the only identifier.

---

## 7. Tests

**Unit**
- Tag normalization and uniqueness clash on rename
- Tiptap projection for every node type, including checklists and code blocks
- Progress calculation (cancelled excluded, empty project)
- Autosave reducer/state machine: idle → saving → saved | conflict | failed → retry

**E2E**
1. Create note by typing → reload → content and formatting intact
2. Autosave offline: go offline in Playwright → type → "Not saved" → back online → saved, content intact
3. Conflict: two pages on the same note → edit both → banner appears → "Load latest" works
4. Link a note from task detail → task appears under the note's "Linked tasks"
5. Create project → add task, todo and note from project page → progress updates when the task is completed
6. Delete project → items still visible as "No project" → restore project → grouping returns
7. Tags: create inline, filter tasks and notes by tag, rename, delete
8. Ownership: linking user A's task to user B's note is rejected with `NOT_FOUND`

---

## 8. Definition of done

- [ ] App is usable as a standalone note-taking app (project plan Phase 3)
- [ ] No content loss in the offline, conflict and reload scenarios above
- [ ] A project can contain tasks, todos and notes, and all of them can also exist with no project
- [ ] Task ↔ note navigation works both ways
- [ ] Tags work on tasks and notes, and filtering works
- [ ] Editor usable on a 360px touch screen

---

## 9. Out of scope (V1)

- Nested projects, project templates
- Note version history
- Image/file embeds, `@mentions` / backlinks inside note text
- Real-time multi-device co-editing (conflict banner only)
- Tags on todos or projects

---

## 10. As built (2026-10-01)

Where the build differs from the text above (details in `agent_docs/notes-projects-tags_v1.md`):

- **Autosave (§4):** a dedicated hook, `useNoteSync`, with a small state machine (`src/lib/notes/save-state.ts`), not `useAutosave`; that hook has no versions or conflicts. A stale save returns `{ outcome: "conflict", version }` as data instead of a `CONFLICT` error, so the banner can offer Load latest / Keep mine. The first save of a new note waits 300 ms, content 800 ms, title 500 ms.
- **`updateNoteMeta` (§5)** takes only `emoji`. A note's project is set with `assignToProject`, like tasks and todos.
- **Note editor (§6):** the toolbar adds a text style menu (paragraph, headings 1–3, code block), strikethrough, quote, divider, undo and redo; a selection menu floats over highlighted text. On a phone the top bar and bottom navigation are hidden on the editor and the toolbar sits above the keyboard. Notes use Inter at 18px (the serif in the design was replaced app-wide, ADR 0003).
- **Task detail (§6):** "Related notes" (chips, Link note, New linked note via `/notes/new?task=<id>`), the tag combobox and the project picker are in. A subtask's picker is disabled: it follows its task.
- **Projects (§6):** the project page edits name, status and description in place; colour is under "Edit details". Deleting asks first ("The tasks and notes in it are kept").
- **Trash:** there is no Trash screen yet (feature 04), so Undo on the toast is the only way back. The restore and permanent-delete actions are built and tested.
- **Filters:** `/tasks` and `/notes` filter by `?project=<id|none>` and `?tag=<id>`. "No project" includes items whose project is in Trash.
- **Seed (technical spec §19):** the demo user also gets 3 projects, 4 tags and 3 notes, joined to the sample tasks.
- **Tests (§7):** the integration layer (real actions on a test database) is added to the unit and E2E scenarios; the autosave state machine is unit tested.

