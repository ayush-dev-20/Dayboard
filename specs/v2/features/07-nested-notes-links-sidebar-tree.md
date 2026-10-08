# Feature 07 — Nested Notes, Links & Sidebar Tree

## 1. Scope

- **Sub-notes:** a note can have child notes (up to 5 levels), shown as blocks in the parent, with breadcrumbs
- **Note links:** inline references to any note, created with `@` or `[[`, opened by a click, always showing the current title
- **Backlinks:** "Linked from" on every note (notes and tasks that link to it)
- **Sidebar tree** under Notes, the **Tree view** on the Notes page, and a Move-to picker
- **Cascades:** trash, restore, archive and unarchive follow the hierarchy, with exact restore sets
- Note links in **task descriptions**, and **New linked note** where a task cannot hold a sub-note

Reuses: feature 01's block registry and node infrastructure, feature 02's paste rule registry, feature 04/05 local data and operations, feature 06's `notes.sort_order` and view slot (`TREE`), V1 trash module (`src/lib/trash.ts`, `src/db/mutations/trash.ts`), `EmojiPicker`, the V1 task↔note links.

Source spec sections: product §16 (all), §18.8 (task descriptions), §13; V1 notes feature doc (relationships, trash).

---

## 2. Data model

### `notes` additions

| Column | Type | Notes |
|---|---|---|
| `parent_note_id` | uuid NULL FK → notes, `ON DELETE CASCADE` | permanent delete removes sub-notes (product §16.3) |
| `depth` | smallint NOT NULL default 1 | 1 = top level. Maintained on create and move (descendants updated in the same transaction). Check `1 ≤ depth ≤ 5` |
| `sort_order` | double precision | added in feature 06; here it orders **siblings** (per parent) |
| `deleted_cascade_id` | uuid NULL | set on every note trashed by the same parent action |
| `archived_cascade_id` | uuid NULL | same, for archive |

Indexes: `(user_id, parent_note_id, sort_order)`, `(user_id, deleted_cascade_id)`, `(user_id, archived_cascade_id)`.

**Cascade ids.** When a parent is trashed, the server generates one `cascade_id`, sets `deleted_at` and `deleted_cascade_id` on the parent **and every non-deleted descendant**, in one transaction. Restoring the parent restores exactly the rows with that `deleted_cascade_id` (descendants that were already in Trash before keep their own earlier state). The same pattern applies to archive. A descendant restored alone while its parent is still in Trash becomes **top level** (`parent_note_id = NULL`, depth 1, subtree depths recomputed) after a confirm.

Depth rule: moving or creating beyond depth 5 is refused (`VALIDATION_ERROR`, "Notes can be nested five levels deep."). Moving a subtree checks `depth + subtreeHeight ≤ 5`.

### `note_links` (derived references for backlinks)

| Column | Notes |
|---|---|
| `source_type` | `NOTE \| TASK` |
| `source_id` | uuid |
| `target_note_id` | uuid FK → notes, `ON DELETE CASCADE` |
| `user_id` | uuid FK → user, cascade |
| `snippet` | text ≤ 200: the text around the link, for the "Linked from" list |
| `created_at`, `updated_at` | |

PK `(source_type, source_id, target_note_id)`; index `(target_note_id)`. **Rebuilt by the server on every save** of a note's `content_json` or a task's `description_json`: in the same transaction it deletes the source's rows and inserts one per distinct `noteLink` node found (sub-note blocks are hierarchy, not links, so they are not stored here). It is derived, never edited by clients, and not a sync entity: pull returns sources, and the local database rebuilds backlinks from local content.

### Editor nodes (feature 01 infrastructure)

| Node | Kind | Attributes |
|---|---|---|
| `noteLink` | inline atom | `noteId` |
| `subNote` | block atom | `noteId` |

Neither stores the title, emoji or address: **identity only**, so rename, move and restore never break them. `sanitizeDoc` allows both nodes; `noteId` must be a UUID. Presentation resolves the title and emoji from the local database live.

### Projection

`content_text` includes the **title at save time** for each link and sub-note block (so searching a title finds notes that mention it). A later rename does not rewrite other notes' text; the backlink join (`note_links`) is the accurate reverse lookup, and search results for the renamed note still find it by its new title. Decision recorded in the as-built doc.

### Local (Dexie)

`notes` store gains `parentNoteId`, `depth`, `sortOrder`; a `noteLinks` store is rebuilt from local content on save; `uiState` keeps the sidebar's open branches.

---

## 3. Server contract

Operations (05) and matching Server Actions in `src/actions/notes.ts`:

| Operation / action | Input | Rules |
|---|---|---|
| `createSubNote` | `{ id?, parentId, title?, emoji? }` | Parent must be the user's, live, depth < 5. New note: `projectId = parent.projectId`, tags empty, placed first among siblings (`sort_order` smaller than the current minimum). Created and saved immediately (an explicit action, unlike a blank new top-level note). Returns the note; the editor inserts the `subNote` block. |
| `moveNote` | `{ id, parentId \| null, beforeId? }` | No self or descendant parent (cycle) → `VALIDATION_ERROR`; depth check for the subtree; recomputes `depth` for descendants; sets `sort_order` between neighbours. |
| `reorderNote` | `{ id, beforeId? }` | Within the same parent. |
| `archiveNote`, `unarchiveNote`, `deleteNote`, `restoreNote` | `{ id }` | **Cascading** per §2 (extend the V1 functions; a leaf behaves exactly as before). |
| `restoreNoteAsTopLevel` | `{ id }` | Used by the confirm when the parent is still in Trash. |
| `permanentlyDeleteNote` | `{ id }` | Removes the subtree (FK cascade). The confirm names the count. |
| `createLinkedNoteForTask` | `{ id?, taskId, title? }` | The V1 "New linked note" (`createNote` with `linkTaskId`) plus returns the node attrs so a task description can insert a `noteLink`. |

Queries (server-rendered pages; the local app uses local data):

- `getNoteTree(userId)`: `id, parentId, title, emoji, sortOrder, childCount` for non-deleted, non-archived notes, with the first 50 top-level notes and all their descendants.
- `getBreadcrumb(userId, noteId)`: ancestors (≤ 4) in order.
- `getBacklinks(userId, noteId)`: from `note_links` joined to live sources (notes not deleted; tasks not deleted), with `kind`, `title`, `snippet`.
- `getNoteMeta(userId, ids[])`: titles, emoji, state (`ok | archived | trashed | missing`) for resolving links on server-rendered pages.

`searchNotesForLink(userId, q)` (picker): recent first when `q` is empty, else title matches then body matches, excluding the note itself, with `path` for disambiguation; `Create "<q>"` is offered client-side.

Ownership: every query and mutation scoped to the user; a parent, target or link id that is not theirs is `NOT_FOUND`.

---

## 4. Editor behaviour

### Sub-notes

- **Insert:** `/sub-note` (registry, surface `note`) or a note-level button creates the sub-note via `createSubNote` (locally first when offline, with a client id) and inserts a `subNote` block at the cursor; the new note opens for title entry in the same click path if the person pressed Enter on the block.
- **Block look:** a row with the note's emoji (or the document icon) and its current title ("Untitled" if empty), a chevron-arrow affordance. It is a link: click or Enter opens the sub-note; Cmd/Ctrl-click and middle-click open a new tab. State variants: **trashed** (muted, "Deleted note" with Restore), **missing** ("Note no longer exists").
- **Removing the block** never deletes or moves the sub-note. A sub-note whose block is not in the parent's text appears in an automatic **Sub-notes** section at the end of the parent (computed from `parent_note_id` minus placed `subNote` blocks), so no sub-note is ever hidden.
- **Task descriptions** cannot hold sub-note blocks. The registry item there is **New linked note**: it calls `createLinkedNoteForTask` and inserts a `noteLink` to the new note, which is also linked to the task (V1 "Related notes").

### Note links

- **Create:** typing `@` or `[[` opens the picker (`NoteLinkPicker`, built on the same suggestion utility as the slash menu). Choosing inserts a `noteLink`. The picker's last entries are **Create "<typed text>" as a note** and **as a sub-note of this one** (notes only; hidden in task descriptions).
- **Pill:** inline element with emoji and **current title**; updates live when the target is renamed. Click or Enter opens the note (Cmd/Ctrl-click: new tab). The link is a real focusable element with an accessible name "Link to note: <title>".
- **States:** archived → works, the target shows its archived banner; trashed → muted "Deleted note" with a small popover "Restore" or "Open Trash"; permanently gone → "Note no longer exists". Restoring a trashed target makes existing links work with no edit.
- **Paste:** a Dayboard note address pasted as plain text becomes a `noteLink` (paste rule registered into feature 02's registry); pasting inside a link pill is ignored.
- A note cannot link to itself from the picker; a self-link by paste is converted to plain text.
- Copy out (02): note links and sub-note blocks become ordinary links to `{origin}/notes/{id}` with the title.

### Backlinks panel

Under the title: **Linked from N** (collapsed). Expanded: a list of notes and tasks, each with a kind label (Note or Task), title, and the surrounding text; click opens the source. Sub-note blocks are not backlinks. Updates as links are added or removed, including after offline edits sync.

---

## 5. Navigation UI

### Breadcrumbs

In the note header: `Notes / Parent / Child` (each part a link; the last is the current note, not a link; long chains collapse the middle to "…" with a menu). The existing project breadcrumb stays for top-level notes. Keyboard and screen-reader friendly (`nav aria-label="Breadcrumb"`).

### Sidebar tree (required)

Component `NotesTree` inside `sidebar-nav.tsx`, below the **Notes** link:

- A chevron on the Notes row expands the tree. **Rows**: indent per level, emoji, title with ellipsis (full title in a tooltip), a chevron for rows with children. Top-level notes first, ordered by `sort_order` (manual). A new note appears at the top of its level.
- Clicking opens the note. The open note is highlighted and its **ancestors auto-expand**. Open branches persist per device (`uiState`).
- **Hover or focus actions:** `+` (new sub-note under this one, depth permitting) and `…` (Move to…, Archive, Move to Trash, Open in new tab).
- **Drag and drop:** drop onto a row → becomes its sub-note; between rows → reorder; depth and cycle rules enforced with the same messages. Uses the library from ADR 0008. Every drag has the keyboard alternative: row menu **Move to…** (picker) and `Alt+↑/↓` to reorder among siblings.
- Shows the first **50** top-level notes with a **Show all notes** link to the Notes page; archived and trashed notes are not shown.
- Collapsed sidebar rail: the tree is hidden; the Notes icon links to the Notes page. Phone: the tree lives inside the menu sheet.
- ARIA tree pattern: `role="tree"`, `treeitem`, `aria-expanded`, `aria-level`, `aria-setsize`/`aria-posinset`; arrows move, Right/Left expand and collapse, Home/End, Enter opens, type-ahead.
- Works offline from local data and updates live (rename, move, create from any tab).

### Notes page

- The list shows **top-level notes**; rows with sub-notes show a chevron and a count and expand in place.
- **Tree view** (`TREE` view type from 06): the whole hierarchy as an expandable outline with drag to move, using the same tree component.
- Search results and the command menu show a note's **path** next to its title (`Parent / Child`).
- **Move to…** dialog (note menu and tree rows): a searchable tree picker with "Top level"; disables the note itself and its descendants; shows depth-limit messages.

### Trash

A trashed parent shows "Includes N sub-notes". **Restore** restores exactly its cascade; restoring a sub-note whose parent is trashed asks "Restore as a top-level note?". Permanent delete states the count ("This also deletes 4 sub-notes."). Archive follows the same wording.

---

## 6. Offline, sync and other features

- **Offline:** creating a sub-note, inserting links, moving and reordering all work offline as commands with client ids. A link to a note that has not synced yet resolves locally.
- **Sync ordering (05):** a sub-note's operations declare `dependsOn` its parent; a link has no dependency (it only holds an id and resolves later). Moves and reorders are LWW. A cycle created by two devices moving notes into each other is detected on apply: the second `moveNote` is `REJECTED` with `VALIDATION_ERROR`, and the client moves the note back to top level and tells the person quietly.
- **Cascades offline:** the local cascade assigns the same `cascade_id` and sends one operation (`note.delete { id, cascadeId }`) so the server applies the same set.
- **Search/AI (10, 11):** note links and sub-note blocks contribute titles to the indexed text; Ask can cite sub-notes; Summarize and Writing help act on one note only.
- **Files (09):** attachments belong to one note; trash and permanent delete follow the same cascade.
- **Tasks (V1):** "Related notes" links are unchanged; a task linked to a parent is not linked to its sub-notes.

---

## 7. Tests

**Unit**
- Tree building and ordering; breadcrumb computation; depth and subtree-height arithmetic; cycle detection; fractional sibling order.
- Cascade sets: trash parent marks exactly the live descendants; restore restores that set; an earlier-trashed child keeps its state; restore-alone becomes top level and recomputes depth.
- Link extraction from documents (`noteLink` nodes, duplicates, links inside toggles and tables, none from `subNote`).
- Link state resolution (`ok | archived | trashed | missing`).
- Picker ranking and exclusion of self.

**Integration**
- `createSubNote`, `moveNote` (cycle, depth, subtree), cascade trash/restore/archive/unarchive with exact sets, permanent delete removes the subtree.
- `note_links` rebuilt on every save of notes and task descriptions; removed when a link is deleted; backlinks exclude trashed sources; ownership (another person's note id is `NOT_FOUND`; backlinks never expose other users' notes).
- Two-device cycle race is rejected cleanly.

**E2E** (acceptance, product §16.6)
1. Create a sub-note from `/`, see the block, click, return with the breadcrumb.
2. `@` picker links to another note; rename the target; the pill updates; Cmd-click opens a new tab.
3. Sidebar tree: expands to the open note, remembers branches, `+` creates a sub-note, drag nests and reorders, keyboard Move to…, "Show all notes" past 50.
4. Notes page Tree view and path in search results; depth limit message.
5. Trash a parent → its sub-notes go with it; Undo restores all; restore the parent restores exactly that set; restore a child alone asks about top level; archive mirrors it.
6. Delete a sub-note block → the sub-note remains and shows under Sub-notes.
7. Links to a trashed note ("Deleted note") and a permanently deleted note ("no longer exists"); restore revives the link.
8. "Linked from" lists notes and tasks and updates; a task description holds a note link; **New linked note** in a task description creates and links.
9. Offline: create, link, move; reconnect; no duplicates or lost notes; the cycle race.
10. Copy a note with a link and sub-note block into another app: ordinary links; paste a Dayboard note address becomes a link.
11. Axe on the tree and pills; keyboard-only tree; 360px (tree inside the sheet).

---

## 8. Definition of done

- [ ] Sub-notes, note links, backlinks, breadcrumbs, the sidebar tree and the Tree view all work as in product spec §16
- [ ] Moving a note updates breadcrumbs, paths and both trees; a cycle or depth-6 note cannot be created, even by two devices
- [ ] Trash and archive cascade with **exact** restore sets and clear counts; permanent delete states what else goes
- [ ] Deleting a sub-note block never deletes the note, and no sub-note is ever hidden
- [ ] Links survive rename, move, archive, trash and restore; missing targets say so
- [ ] Task descriptions hold note links; **New linked note** works there
- [ ] Everything works offline and syncs without duplicates
- [ ] The sidebar tree is an accessible tree and usable on a phone
- [ ] Migration is expand-only; V1 notes keep working unchanged (all top level, depth 1)
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `theme:check` pass
- [ ] `agent_docs/nested-notes-links-sidebar-tree_v2.md` written and indexed

---

## 9. Out of scope (V2)

A graph view; linking to tasks or projects from the picker (built so it can be added); transclusion or embedding another note's content; duplicating a subtree; per-note permissions or sharing; a project or tag inherited by sub-notes after creation; summarising sub-notes together; unlinking tasks from sub-notes automatically.

---

## 10. As built (2026-10-08)

What differs from the sections above. The agent hand-off is `agent_docs/nested-notes-links-sidebar-tree_v2.md`.

- **Server-side only.** Features 03 to 05 were skipped on purpose, so nothing here works offline, `uiState` is `localStorage` (open branches and whether the tree shows), and other tabs follow through a `BroadcastChannel`. Not done: the offline E2E cases (§7, 9), `dependsOn` and `note.delete { cascadeId }` operations, and the offline-created cycle rule on apply (the server half exists: hierarchy changes take a per-person lock, so the second of two crossing moves is refused).
- **No client-made ids.** `createSubNote` and `createLinkedNoteForTask` take no `id` (a duplicate key would reveal whether someone else's id exists). `moveNote` takes `beforeId` **and** `afterId` (the neighbours), like `reorderNote`; with neither the note goes first. `getNoteMeta` is an action (`getNoteMetas`) used by the links; the picker is `findNotesForLink`; `loadBacklinks`, `loadNoteOutline`, `loadNoteTree` and `loadNoteChildren` feed the UI.
- **Derived links.** `note_links` has two delete triggers (migration 0008) because `source_id` cannot be a foreign key. A link to a note that is not the person's stores nothing. A note linking to itself is not a backlink.
- **Archive mirrors Trash**, including "unarchive as a top-level note" when the parent is still archived. Creating a sub-note under an archived note, or moving into one, is refused ("Unarchive this note…").
- **Trash:** a note trashed together with its parent is not listed on its own; the row says "Includes N sub-notes". Empty trash names the sub-notes it also removes. Permanent delete names every sub-note, in any state.
- **Notes page (owner's decision, 2026-10-08):** every main view (List, Gallery, Table, Board) and the note lists on project pages list **top-level notes only**; there is no expand-in-place and the count and Archived list agree. Sub-notes are reached through their parent, the sidebar tree and the Tree view, which ignores filters, sorts and grouping.
- **Sub-note block of a note in Trash or gone:** shows nothing (no "Deleted note" row, no Restore); the block stays in the text and returns on restore. Inline links still show "Deleted note" with Restore.
- **Phone:** the tree is in a sheet opened from a "Browse notes" button on the Notes page and in the note header (there is no menu sheet on a phone). The breadcrumb is hidden on a phone; the back arrow goes to the parent.
- **Tree drag** is pointer and touch only (keyboard: `Alt+Up/Down` and Move to…), with Undo on every move.
- **Pasted note addresses** become links only for this app's own origin(s) and over an empty cursor; the note's own address stays text; over selected text it stays an ordinary link.
- **Copy out:** a note link or sub-note block is an ordinary link with the note's current title (a title not loaded yet reads "Note"); the Dayboard flavour keeps the real nodes. Pasting a sub-note block into a task description leaves a link.
- **Search:** results carry a `path`, shown before the title in the command menu and on `/search`. The projection (`content_text`) includes link and sub-note titles as of the save.
- **Not built:** a path column in the Table; a live refresh of a task's "Related notes" chips after "New linked note" from its description (the next load shows it). No design file existed for these screens; built from `DESIGN.md`.
