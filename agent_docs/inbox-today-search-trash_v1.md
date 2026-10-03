# Feature: Inbox, Today, Search & Trash

**Phase:** V1
**Status:** Done (code, tests and docs). Docker was not run; see "Not verified".
**Date:** 2026-10-02

## What was built
- **Quick capture and Inbox:** one command menu (`⌘/Ctrl+K`) for Search and Create, with capture always one keystroke away (`⌘/Ctrl+Enter` on typed text, or `C` for a plain capture box). The Inbox page lists open items and converts each to a task, todo, note, task + note, or project idea through one confirm dialog. Archive, delete (with Undo), and a "Recently converted" section with links to what was made.
- **Today:** greeting, quick capture, a Focus card (chosen by hand, clears itself when done), Overdue, Today (+ "Scheduled later today"), Todos, Needs planning, Recently updated notes, and a collapsed Completed today. An empty day says so. The sidebar shows the Today and Inbox numbers. **Rebuilt in feature 07** (`ui-modernization_v1.md`): day-progress ring, focus hero with suggestions (`focus-hero.tsx`), the AI brief carrying "Help me clean up", a collapsible Overdue, and a right rail (Up next, Recently updated notes, Inbox, getting-started checklist).
- **Search:** the command menu (results grouped by type, recent searches and items) and a `/search` page with type tabs and Status / Project / Tag / Due-updated filters, all in the URL. Archived items are labelled; Trash is never searched.
- **Trash:** one list of everything deleted (tasks, todos, notes, projects, inbox items) with type tabs, Restore, Delete permanently and Empty trash, each destructive step confirmed.
- Tests: 280 unit, 124 integration, and the Playwright suite (desktop and phone), all run against a production build.

## Why
These are the views that cut across every item type, so each is built on the owning feature's own queries and actions: Today reuses `TaskRow`/`TodoRow`/`NoteCard`, conversion calls the same `createTask`/`createNote`/`createTodo`/`createProject` inside one transaction, and Trash calls each feature's own `restore*` and `permanentlyDelete*`.

## What was deferred
- **AI:** built in feature 05 (`ai-assistant_v1.md`): the Today suggestion slot, the inbox suggestion chip and the menu's Ask tab.
- Inline editing of an inbox item's text: `updateInboxItem` exists and is tested but has no UI. Saved searches, `pg_trgm` indexes and automatic trash purge are out of scope (add the index only if search is slow).

## Related files
- `src/db/schema/inbox.ts`, `drizzle/migrations/0003_inbox-and-focus.sql` (also adds the foreign key on `user_preferences.focus_task_id`).
- `src/db/mutations/inbox.ts` (`convertInboxItem` is one transaction), `src/db/mutations/{today,trash}.ts`, `src/db/queries/{inbox,today,search,trash,nav-counts}.ts`, `src/actions/{inbox,today,trash}.ts`, `src/app/api/search/route.ts`.
- `src/lib/search/` (escape, ranking, snippets, URL), `src/lib/inbox/convert.ts` (first-line / rest rules), `src/lib/today/buckets.ts`, `src/lib/trash.ts`.
- `src/components/command/` (provider, menu, capture box), `components/inbox/`, `components/today/`, `components/search/`, `components/trash/`.
- `src/db/executor.ts`: `inTransaction(outer, fn)`, used by the create functions so they can run inside a bigger transaction.
- Tests: `tests/unit/inbox-today-search.test.ts`, `tests/integration/inbox-today-search-trash.test.ts`, `e2e/{inbox,today,search,trash}.spec.ts`.

## Hand-off notes
- **Capture never throws.** `saveToInbox` (components/command/capture.ts) turns a dropped connection into a failed result, so the text stays and Retry works. Use it for any new capture entry point; a bare `await captureInboxItem()` rejects when offline.
- **Search is ILIKE** with `%`, `_` and `\` escaped, 2–200 characters, ranked exact title > prefix > contains > body, ties newest first. Snippets are cut in SQL and returned as `{ before, match, after }` text segments, rendered with `<mark>`, never HTML. A status filter means tasks only; a tag filter means tasks and notes. The menu calls `GET /api/search` (150 ms debounce; the next keystroke aborts the last request); the query is never logged.
- **"Today" is the person's day:** it rolls over at their start-of-day, so a timed task whose time passed is Overdue, an untimed task due today is Today, a later time is "Scheduled later today".
- **Focus** lives in `user_preferences.focus_task_id` (set to NULL if the task is permanently deleted). `getTodayData` clears it when the task is completed, cancelled, archived or deleted. Only an open top-level task of the person's own can be chosen.
- **Trash lists only the top of a deleted group:** a subtask deleted with its parent has no row (restoring the parent brings both back); a subtask deleted on its own is listed itself. Restore keeps feature 02/03 rules (a task whose project is still trashed shows "No project"). Empty trash is one transaction.
- **Conversion** can't run twice (`CONFLICT`), keeps the item OPEN if anything fails, and leaves out links to records deleted since. A project idea is created `ON_HOLD`.
- **The command menu mounts only while open**, so its state (query, recent searches) starts fresh each time. Cmd/Ctrl+K works while typing on purpose; `C`, `N`, `T`, `Shift+N` do not.
- **Sidebar numbers** come from the app layout (`getNavCounts`). Inbox actions and Trash refresh the layout; completing a task refreshes it when the Undo toast closes.
- **New package:** `cmdk` (already in the stack list).
- **Machine load:** on a busy laptop a full Playwright run can time out tests that pass on their own; run with `--workers=4` if that happens.
- **Design vs spec:** the design's Convert is a button that opens one dialog with tabs; here the button is a menu of the five targets that opens the same dialog on that tab. The mobile Today/Inbox headers use the app's own top bar.

## Not verified
- Touch behaviour and the on-screen keyboard on a real phone (emulated only); Safari and Firefox.
- The Dockerfile and Compose with the new migration: Docker is not installed on this machine.
