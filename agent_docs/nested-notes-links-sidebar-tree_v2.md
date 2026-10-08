# Feature: Nested notes, links and the sidebar tree

**Phase:** V2 (feature 07)
**Status:** In progress. Everything works on the server-backed app. Offline use and sync wait for features 04 and 05, which were skipped on purpose.
**Date:** 2026-10-08

## What was built

- **Sub-notes.** A note can have sub-notes up to five levels deep (`notes.parent_note_id`, `depth`). `/sub-note` in the editor (or "New sub-note" in the note menu, or `+` on a tree row) makes one at once, in the parent's project, first among its siblings. It shows as a **block** in the parent, and a sub-note whose block is not in the text is listed under **Sub-notes** at the end of the parent, so none is ever hidden. A block whose note is in Trash (or gone) shows **nothing** in the text (owner's request: no "Deleted note" row); it comes back by itself when the note is restored. Breadcrumbs (`Notes / Parent / Child`, long chains fold the middle into "…") sit in the note header.
- **Note links.** `@` or `[[` opens a picker over the person's notes (recent first, then title matches, then body matches; never the note itself; each result with its path; "Create … as a note / as a sub-note of this one"). A link is an inline pill that holds only the note's id and shows the **current** title, so a rename, move, archive or restore never breaks it. A note in Trash reads "Deleted note" (with Restore / Open Trash), a note gone for good "Note no longer exists". Pasting a Dayboard note address as text makes a link.
- **Linked from N** under the title: the person's own live notes and tasks that link here, with the words around the link. Task descriptions hold note links too; in a task the slash item is **New linked note** (it makes the note, links the task to it, and puts a link in the text).
- **Sidebar tree** under Notes (chevron on the Notes row shows and hides it): an ARIA tree (arrows, Right/Left, Home/End, Enter, type-ahead), `+` and `…` on each row, drag to nest or reorder, `Alt+Up/Down` to reorder, **Move to…** (a searchable picker) as the keyboard and touch way, ancestors of the open note open by themselves, open branches remembered per device, the first 50 top-level notes with "Show all notes". On a phone it opens in a sheet from the Notes page and the note header.
- **Tree view** on the Notes page (the `TREE` view type from feature 06): the whole outline, same component. **The main views (List, Gallery, Table, Board, and the note lists on project pages) list top-level notes only**: the query leaves sub-notes out, the header count and the Archived list agree. Sub-notes are reached through their parent, the sidebar tree and the Tree view. (The spec's "expand in place" and "path in a flat list" were built and then removed at the owner's request.)
- **Trash and archive follow the hierarchy.** One cascade id per action: trashing or archiving a parent takes every sub-note not already in that state; restoring brings back exactly that set. Trash lists the top of a group ("Includes N sub-notes"); restoring a sub-note whose parent is still in Trash (or archived) asks "Restore as a top-level note?"; deleting for good says how many sub-notes go too.
- **Search** shows a note's path next to its title (command menu and `/search`); the text projection includes the titles of linked and sub-note notes.

## Why

V1 notes were flat. The product spec (§16) wants Notion's two ideas, hierarchy and references, with one deliberate difference: removing a block never deletes the note. The hierarchy lives in `parent_note_id`, not in the blocks, so editing text can never move or lose a note.

## What was deferred

- **Offline and sync (features 04 and 05).** Nothing here works offline. Open branches live in `localStorage` (not Dexie `uiState`); other tabs of the same browser follow through a `BroadcastChannel`. The server contract has no client-made ids (`createSubNote { id? }` in the feature doc) because a duplicate key would show whether another person's id exists; add them with the sync engine, together with `dependsOn` for a sub-note's operations and the two-device cycle rule on apply (the server side of that rule is built: moves take a per-person lock, so the second of two crossing moves is refused).
- **Tree view** ignores filters, sorts and grouping (its settings button is hidden).
- Not built: a **Location/path column** in the Table, and a refresh of a task's "Related notes" chips after "New linked note" from its description (the link exists; the chips update on the next load; not checked in the browser).
- No design file exists for the tree, breadcrumbs, pills or backlinks (the `designs/` HTML predates V2). Built from `DESIGN.md`; the owner has not signed these off.
- Not tested on a real phone, in Safari or Firefox (Chromium only). Docker was not run.

## Related files

- **Pure rules (no database, no React):** `src/lib/notes/tree.ts` (outline, depth, cycle, breadcrumb parts), `cascade.ts` (which notes a trash/archive reaches and which a restore brings back), `links.ts` (reading links and blocks out of a document, snippets, link states, note addresses), `picker.ts` (picker order), `tree-drop.ts` (what a drop or Alt+Arrow means). `src/lib/editor/clipboard/note-refs.ts` (links on copy), `fit.ts` (`subNotesToLinks`).
- **Server:** `src/db/mutations/note-tree.ts` (create sub-note, move, trash, restore, archive, permanent delete; all take `lockTree` first), `note-links.ts` (`projectDoc`, `syncNoteLinks`), `notes.ts` (re-exports, saves rebuild links), `tasks.ts` (`updateTaskDescription` and the recurrence copy rebuild links). `src/db/queries/note-tree.ts` (`getNoteTree`, `getOutline`, `ancestorsFor`, `getBacklinks`, `getNoteMeta`, `searchNotesForNoteLink`), `trash.ts` (cascade-aware list). `src/actions/notes.ts`. `drizzle/migrations/0008_nested-notes.sql`.
- **Editor:** `src/components/editor/blocks/note-nodes.tsx` (`noteLink`, `subNote`), `note-link-views.tsx` (pill and block views), `note-link-picker.tsx` (`@` and `[[`), `suggestion-popup.tsx` (the popup shared with the slash menu), `note-blocks.ts` (the two slash items), `note-create.ts`.
- **UI:** `src/components/notes/` (`note-events.ts`, `note-meta-store.ts`, `use-note-tree.ts`, `note-breadcrumb.tsx`, `backlinks-panel.tsx`, `sub-notes-section.tsx`), `src/components/notes/tree/` (`notes-tree.tsx`, `move-note-dialog.tsx`, `notes-tree-view.tsx`, `notes-tree-sheet.tsx`, `sidebar-notes-tree.tsx`, `use-open-branches.ts`, `note-move.ts`), `src/components/views/dnd.tsx` and `dnd-nodes.tsx` (`TreeRowDrag`, `TreeRootDrop`, `useTreeSensors`).
- Tests: `tests/unit/note-tree.test.ts`, `note-links.test.ts`, `note-clipboard.test.ts`; `tests/integration/nested-notes.test.ts`; `e2e/nested-notes.spec.ts`, `nested-notes-tree.spec.ts`, `nested-notes-lifecycle.spec.ts`.

## Hand-off notes

- **Hierarchy lives in `parent_note_id`; blocks are pointers.** Never derive a note's parent from a block. A pasted block is another pointer to the same note (it does not move it).
- **Depth is stored and kept by the server**, for the whole subtree including archived and trashed notes, so a restore can never break the limit of five. `moveNote` and `createSubNote` check it (`checkDepth`), and a check constraint backs it up.
- **Cascade ids:** `deleted_cascade_id` / `archived_cascade_id`. A restore brings back the note and the descendants carrying its id, reached only through notes carrying it. A note with no id (trashed before this feature) restores alone. A live note never sits under a trashed parent; the one way a child is restored first is `restoreNoteAsTopLevel`, which also recomputes depth.
- **`lockTree`** (`pg_advisory_xact_lock` per person) serialises every structural change. Without it two crossing moves both pass the cycle check.
- **Arranging is not editing:** moves and depth shifts keep `updated_at` (they set it back with `keepUpdatedAt`). Trash, archive and restore bump it, as in V1.
- **`note_links` is derived.** Never write it from a client. It is rebuilt in the same transaction as every save of a note or task description (and for the repeating-task copy). Two triggers in migration 0008 delete a source's rows when the source is deleted for good, because `source_id` cannot have a foreign key. A link to a note that is not the person's stores nothing and reveals nothing.
- **Sub-note blocks are refused in task descriptions** by `sanitizeDoc` (`allowSubNotes`; `noteRichTextSchema` for notes, `richTextSchema` for tasks and AI). Pasting one into a task becomes a link (`subNotesToLinks`). The two new nodes are in `NODE_TYPES`, so the clipboard scrub accepts them.
- **The sidebar tree is data from the app layout** (`WorkspaceProvider.noteTree`). Structural actions revalidate the layout (`refreshTree`); creating a note or sub-note while typing does not (the editor keeps running), so it announces itself with `emitNoteEvent`. `useNoteTree` applies events and re-reads on `structure`; a newer server render replaces its state.
- **A treeitem needs `aria-label={title}`**: its content includes its row buttons and its whole branch.
- **Tree drags are pointer and touch only** (`useTreeSensors`); the keyboard alternatives are `Alt+Up/Down` and Move to…. Only the row (not its branch) is the draggable, so above/onto/below is measured against the row (`zoneAt`).
- **Link titles come from `note-meta-store.ts`** (batched, 30 s stale time, refreshed on `structure` and rename events). Copying a note writes titles from that store; a title not loaded yet is written as "Note".
- **Tests of the editor in jsdom must mock `@/actions/notes`** (the node views import it): see the top of `tests/unit/clipboard-editor.test.ts`.
- **Dev database:** run `pnpm db:migrate` (migration 0008) before opening the app. On Vercel/Neon migrations are not automatic: apply them by hand.
- Related: `notes-projects-tags_v1.md`, `editor-blocks-and-lists_v2.md` (block registry, `surfaces`, the `Links` group), `clipboard-fidelity_v2.md` (paste rule registry), `multiple-views_v2.md` (the `TREE` slot, `dnd.tsx`), `inbox-today-search-trash_v1.md` (Trash), ADR 0008.
