# Feature: Notes, Projects & Tags

**Phase:** V1
**Status:** Done (code, tests and docs). Docker was not run; see "Not verified".
**Date:** 2026-10-01

## What was built
- **Notes:** a full-page editor (`/notes`, `/notes/new`, `/notes/[id]`) with a toolbar, a selection menu, emoji, project, tags, archive, trash with Undo and "Linked tasks". Autosave never loses text: offline typing, a conflict with another window, and a closed tab are all handled (see hand-off notes). A new note is created on its first keystroke.
- **Projects:** list by status with progress, a detail page (name, status and description edited in place, quick add of a task, todo or note, open tasks, todos, notes, completed tasks), a picker used everywhere, and Trash with Undo. Everything also works with no project.
- **Tags:** created inline from a combobox on tasks and notes, filters on both lists, and Settings → Tags (rename, colour, delete with usage counts). Task ↔ note linking works both ways ("Related notes" on a task, "Linked tasks" on a note, "New linked note").
- Tests: 248 unit, 92 integration (28 new, including a table-driven ownership check), 128 Playwright (desktop and phone). A production build was made by the Playwright run.

## Why
Notes and projects are what turn a task list into a workspace, and the spec wants no content lost, ever. The server owns every rule (ownership on both sides of a link, version check, project and tag limits); the client only keeps text safe and asks the person when two copies disagree.

- **Since feature 07** (`ui-modernization_v1.md`): the Projects page is a card grid (`ProjectCard` with color strip, progress, counts and next due task from `nextDueTasks()`), and Notes has a list/grid toggle (`?view=grid`, `NoteTile`).

## What was deferred
- Trash screen, search, Inbox, Today and quick capture were built in feature 04 (`inbox-today-search-trash_v1.md`), which calls these restore and permanent-delete actions. AI actions on notes (Summarize, Extract tasks): built in feature 05 (`ai-assistant_v1.md`).
- Tags on todos and projects, nested projects, note history and backlinks (out of scope in V1).

## Related files
- `src/db/schema/{projects,notes,tags}.ts`, `drizzle/migrations/0002_notes-projects-tags.sql` (also adds the `project_id` foreign keys on tasks and todos).
- `src/db/mutations/{projects,notes,tags,guards}.ts`: every write; `guards.ts` is the "both sides belong to the person" check. `src/db/queries/{projects,notes,tags,meta}.ts`: reads; `meta.ts` batches project and tags for lists (no N+1).
- `src/actions/{projects,notes,tags}.ts`; Zod in `src/lib/validations/{projects,notes,tags}.ts`.
- `src/lib/notes/save-state.ts` (the save state machine), `draft.ts` (local drafts), `src/components/notes/use-note-sync.ts` (the hook), `note-editor.tsx`, `linked-tasks.tsx`.
- `src/components/editor/toolbar.tsx`: formatting bar and selection menu (the editor itself is still the one `RichTextEditor`).
- `src/components/workspace/`: `WorkspaceProvider` (projects and tags from the app layout), `ProjectPicker`, `TagPicker`, `ColorDot` / `ProjectToken` / `TagBadge`. `src/components/projects/`, `src/components/settings/tags-manager.tsx`.
- `src/lib/projects/progress.ts` (progress rule), `src/lib/tags.ts` (normalisation).

## Hand-off notes
- **Never send raw ProseMirror JSON to a Server Action.** Node attributes (a heading's level, a checklist item's `checked`) have no prototype, so React sent them as nothing: headings were refused and ticked checklist items saved as unticked. This also affected feature 02 task descriptions. `RichTextEditor` now round-trips the document through JSON (`toPlainDoc`). Keep that if you add another editor.
- **Saving a note** returns `{ outcome: "saved" | "conflict", version }` as data, not an error, so the editor can offer Load latest / Keep mine (the spec said `CONFLICT`; this carries the latest version). Each save sends the version the editor last saw; title and content saves are sent one at a time. `useAutosave` was not reused (it has no versions or conflicts); tasks still use it.
- **`createNote` does not revalidate.** The editor keeps running while `history.replaceState` changes the address; a refresh would reset it. Later actions that revalidate (project, tags, archive) do remount the editor once, after the text is already saved.
- **A project in Trash:** its tasks, todos and notes stay active and show "No project"; `project_id` is kept, so restoring brings the grouping back. Lists join `projects` with `deleted_at IS NULL`. Permanent delete sets the column to NULL.
- **A subtask has no project of its own:** it copies its parent's, and moving the parent moves it (`assignToProject`). Its picker is disabled.
- **Progress** = done ÷ (total − cancelled) over top-level tasks and todos that aren't archived or deleted; no items shows "No items yet", never 0%.
- **Tags:** unique per person by normalised name (trim, lower-case, collapse spaces); creating an existing name returns it; at most 10 per item; deleting is final and cascades to links.
- **Workspace lists:** the app layout loads projects and tags once; project and tag actions revalidate the whole layout so pickers stay current.
- **Menus that open a picker** (the note's "…" menu) must open it from `onCloseAutoFocus`, or the menu hands focus back to its button and the picker closes at once.
- **The note page hides the top bar and bottom nav on phones** (`isNoteEditorPath`), so the formatting bar sits above the keyboard (`useKeyboardInset`).
- **E2E gotcha:** Playwright reuses any server already on :3100. A leftover one serves an old build and gives misleading results; stop it first.
- **New packages:** `@tiptap/extension-bubble-menu` (selection menu) and `@floating-ui/dom` (its positioning). The fonts are Inter now (ADR 0003).
- **Design vs spec:** the note's Project and Tags menu items open anchored pickers, not new pages. On a phone "New note" is a button in the page header (the design shows a "+" in the top bar). The project page reuses `TaskList` with one group.

## Not verified
- Touch behaviour and the on-screen keyboard on a real phone (emulated only); Safari and Firefox.
- The Dockerfile and Compose with the new migration: Docker is not installed on this machine.

- **Since feature 08** (`ai-writing-and-planning_v1.md`): `RichTextEditor` accepts `onEditorReady` / `onEditorDestroy` and `writingHelp`; its extensions live in `components/editor/extensions.ts` (shared with the read-only AI preview). The note menu has "Generate with AI", and `/notes/new?ai=1` opens the panel without creating a note.
