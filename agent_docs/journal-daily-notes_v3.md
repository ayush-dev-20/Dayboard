# Feature: Journal (daily notes)

**Phase:** V3 (feature 02)
**Status:** In progress. Slices A (the entry, the Journal tab, list and sidebar) and B (Done on this day, Add to entry) are built and tested. Slice C (the starting template) waits for feature 03 (Templates).
**Date:** 2026-10-20

## What was built

- **An entry is a note that carries a date** (`notes.journal_date`, migration `0020`): one live entry per person per day (partial unique index), always top level (check). No new table. The editor, autosave, conflict banner, device draft, tags, project, links, backlinks, files, Ask / Update with AI, Trash and archive are the note's own; `NoteEditor` takes a `journal` prop (`{ date, done, timeZone }`).
- **The server decides the day** (`getUserToday` with the person's time zone and start of day). `createJournalEntry` (action, no date input) creates today's entry or answers `{ outcome: "exists", id }`; the unique index settles two calls at the same moment. A typed title is kept; the default is `journalTitle(date)` ("Tuesday, 13 October 2026").
- **Pages:** `/journal` (Today row on top, entries by month, "Load more" at 30, archived folded below, empty state), `/journal/today` (opens today's entry, or an editor in "new" mode that saves nothing until the person types), `/journal/[id]` (the note page; `?task=` opens a finished task in the side panel). `/notes/{id}` **redirects an entry to `/journal/{id}`**, so every old link, pill and backlink still works.
- **Done on this day** (`DoneOnThisDay`, `getDoneOnDay`): tasks (archived and sub-tasks included, each completed occurrence of a repeating task is its own DONE row) and todos completed inside `dayBounds(date, prefs)`, in completion order, capped at 200 with "and N more". Worked out when the page opens; never stored in the note. A task opens in the side panel, a todo in `TodoEditDialog`. **Add to entry** appends a "Done" heading and a bullet list of titles as one undo step (`doneDocument` + `appendDoc`); it writes nothing by itself; the label changes to "Add again".
- **Sidebar and navigation:** a Journal row (Notes, Journal, Canvases, ...) with a chevron (`useSidebarSection("journal")`) and a **+** (`JournalAddAction`, the first row-level add control; 44 px on touch, hidden until hover/focus on desktop), the latest five entries as `Tue 13 Oct`, and "Show all". Under More on a phone; `isNoteEditorPath` matches `/journal/{id}` and `/journal/today`; command menu has "Journal: today's entry" and "New journal entry".
- **Where entries are and are not.** Left out of the Notes collection through one condition, `plainNotes` (`src/db/queries/note-filters.ts`, re-exported from `queries/notes.ts`): the Notes list and count, every view and project page (`listNotesForViews`), the sidebar tree and Tree view, Move to, the onboarding checklist and the weekly review's note counts. Included everywhere a note is reached by id, link or search: search (type stays `note`, the hit carries `journalDate`, label **Journal**, href `/journal/{id}`), Trash (label Journal), backlinks, the `@` picker and the task "Link note" picker (calendar glyph and date), the assistant, the semantic index.
- **What an entry cannot do:** hold sub-notes (`createSubNote`, `moveNote` refuse; the slash item and the picker's "as a sub-note" are hidden through `subNotes={false}`; a sub-note block saved into an entry becomes a link), be moved, or change its date (no action takes one; strict Zod schemas).
- **Trash:** restoring an entry onto a day that already has a live entry is `CONFLICT` ("There is already an entry for that day. Open it, or delete it first."); permanent delete frees the day. An archived entry still holds its day.
- **Indexes** for the Done query: `tasks_user_completed_at_idx`, `todos_user_completed_at_idx` (partial, `completed_at is not null`).

## Why

A person who finishes work every day has nowhere to write about it. Making the entry a note reuses everything about writing and keeps Journal as a place, not a feature: the only new rules are "one per day", "never in the Notes collection" and "show what was finished".

## What was deferred

- **Slice C**: a starting template for new entries (feature 03). The seam is `/journal/today`'s "new" mode, which will call `getJournalTemplate` and `applyPlaceholders` with the entry's day.
- Sticky notes (`kind = 'STICKY'`, canvas slice D) are listed in Done on this day with their board's name, unless their board is in Trash or archived (`getDoneOnDay`, `countDoneByDay`).
- No entries for past or future days (the list is the way back), freezing the Done list, mood, streaks, reminders, sharing, offline editing (notes are server-backed today). See the feature doc's out of scope.
- Not tested on a real phone, Safari or Firefox. No journal design file exists; built from `DESIGN.md` and the Notes and Projects screens, so the owner has not signed off the look.

## Related files

- `src/db/schema/notes.ts` (column, check, index), `drizzle/migrations/0020_journal.sql`, `src/db/schema/{tasks,todos}.ts` (completion indexes).
- `src/lib/dates/journal.ts` (`journalTitle`, `journalShortDate`, `journalMonthLabel`, `dayBounds`, `doneTime`), `src/lib/journal/{dto,done-doc}.ts`, `src/lib/validations/journal.ts`, `src/lib/preferences.ts` (`getDayPrefs`).
- `src/db/mutations/journal.ts` (`createJournalEntry`), `src/db/queries/journal.ts` (`getJournalEntry`, `getDoneOnDay`, `countDoneByDay`, `listJournalEntries`, `listSidebarEntries`, `getJournalTarget`), `src/db/queries/note-filters.ts` (`plainNotes`, `journalEntries`), `src/lib/notes/query-classes.ts` (every query that reads `notes`, classed `plain` or `includes`), `src/actions/journal.ts`.
- Shared files touched: `db/mutations/{notes,note-tree,reused-id}.ts` (sub-note blocks to links on save, structure guards, restore conflict), `db/queries/{notes,note-tree,views,onboarding,search,trash}.ts`, `lib/review/load.ts`, the editor (`rich-text-editor-inner.tsx`, `blocks/{context,note-blocks,note-link-picker}`), `components/notes/{note-editor,use-note-sync,note-events}.ts(x)`, trash list, search result, command menu, nav (`nav-items.ts`, `sidebar-nav.tsx`, `workspace-context.tsx`, app layout, `proxy.ts`, More), `use-open-task.ts`.
- `src/app/(app)/journal/**`, `src/components/journal/{sidebar-journal,done-on-this-day,journal-list,journal-row}.tsx`.
- Tests: `tests/unit/{journal-dates,journal-done-doc,note-query-classes}.test.ts`; `tests/integration/journal.test.ts`; `e2e/journal.spec.ts`.

## Hand-off notes

- **Adding a query that reads `notes`?** Add it to `NOTE_QUERY_CLASSES` (`plain` if it lists the Notes collection and must use `plainNotes`, `includes` if it reads by id, link or search). `tests/unit/note-query-classes.test.ts` fails until you do.
- **Days follow today's preferences.** `dayBounds` uses the person's *current* time zone and start of day, so changing them re-slices history (an old entry's Done list and counts move with them). The entry's own `journal_date` never changes.
- **A day with a daylight-saving change is 23 or 25 hours long**, counted from one start of day to the next; the one that contains the change is the day that began before it.
- **The "exists" path.** If `createJournalEntry` answers `exists` (another tab or device made the entry first), the editor writes what was typed as the **device draft of that entry** and opens it; the existing "Recover / Discard" banner offers it back. Nothing is merged silently.
- **Blank title:** nothing is stored; the list and breadcrumb show the date. A renamed entry shows its date under the title.
- **Weekly review and onboarding use `plainNotes`:** a daily entry does not count as a note created or tick "write your first note". Tag usage counts include entries (they count real usage), so a tag filter in Notes can show fewer notes than the count.
- **A project page does not list entries** (it is a view of the Notes collection); an entry with a project is reached from Journal, search or a link.
- **E2E:** the rollover test switches the person's time zone between two zones 25 hours apart instead of faking a clock (there is no server clock seam). `e2e/db.ts` has `insertJournalEntry`, `journalEntriesOf`, `insertDoneTask`, `insertDoneTodo`, `setTimezone`.
- **Migration `0020`** is applied to the test and dev databases. Neon still needs it (run it only when the owner asks, after printing the host).
- Related: `notes-projects-tags_v1.md`, `nested-notes-links-sidebar-tree_v2.md` (the tree, Trash cascade ids, `lockTree`), `canvas-with-ai-diagrams_v3.md` (sidebar section pattern, sticky boards), `inbox-today-search-trash_v1.md`, `tasks-and-todos_v1.md`.
