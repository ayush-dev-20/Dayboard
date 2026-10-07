# Feature: Multiple views

**Phase:** V2 (feature 06)
**Status:** In progress. Views work end to end on the server-backed app. The offline and sync parts wait for features 04 and 05, which were skipped on purpose.
**Date:** 2026-10-07

## What was built

- **Saved views per collection** (Tasks, Todos, Notes), kept in the `collection_views` table: List, Table, Board, Calendar (tasks and todos) and Gallery (notes). Tabs above the items, a **+ View** menu (types and ready-made starts), a tab menu (rename and icon, duplicate, move, delete with Undo), and **View settings** (filters, sorts, group by, visible columns, card size, calendar options, how an item opens). Changes save by themselves after half a second.
- **A pure view engine** in `src/lib/views/`: `runView(collection, items, config, ctx)` filters, sorts and groups, and every view type draws what it returns. The List view uses it too, with the V1 components, so a row looks and behaves as before.
- **Drag between columns** (Board) and **between days** (Calendar) with `@dnd-kit` (ADR 0008). A drop becomes ordinary commands (`planMove`), runs the same Server Actions as everywhere else, shows at once, and a toast offers Undo. Impossible drops (Overdue, "This week" with no days left, a tag column for a note that has the tag) are refused with a message and change nothing. Every card also has a **Move to** menu, and every calendar item a **Move to date** picker; the keyboard lifts with Space.
- **Table:** sortable headings (Shift adds a sort), hide, reorder (menu) and resize (pointer or arrow keys) columns, a frozen title, cells that edit in place, row selection with a bulk bar (status, priority, due date, project, tags, complete, archive, Trash; one Undo for the lot).
- **Project pages** show the same views for tasks, todos and notes, each limited to the project (an implicit filter that cannot be removed).
- **Defaults and legacy:** the migration backfills one List view per collection per user (equal to `defaultConfig(..., "LIST")`); new accounts get them on sign-up; `?view=todos`, `?view=grid` (makes a Gallery once), `?view=list` and `?view=<uuid>` still work; the last view used per collection is remembered in a cookie.
- **Notes** gained `sort_order` (manual order; a new note goes on top).

## Why

One list per collection could not show the same work as a board, a table or a calendar. Views are data, not code: each one is a config (Zod-checked per collection) read by one engine, so a new view type or property is a registry entry, not a new page.

## What was deferred

- **Offline and sync (feature 04 and 05).** Views are server-side only. `collection_views` already has `version`, `last_modified_by_device_id` and `deleted_at` (soft delete) so sync can adopt it, but there is no Dexie copy, no operations and no `groupId`. The E2E case "every view works offline" is not written. The feature doc's "Views work offline" box stays unticked.
- **Drag to reorder columns and table headings:** done through menus (Move left / Move right), not by dragging.
- **Table role:** a real `table` (not `grid`); the cells edit through their own buttons and menus.
- **`openIn`** (panel or page) is a setting for Tasks only; todos always open the panel and notes the page.
- **Finished and archived items are read only when a view can show them**, and at most 500 of them (`VIEW_CLOSED_LIMIT`); open items are capped at 2,000 (`VIEW_ITEM_LIMIT`). Beyond that nothing more is read and **no message says so** (rows are paged on the screen, 50 at a time, never from the server). Add a notice or server paging if an account really has more.
- **Tree** view type is registered but disabled until feature 07. **Google Calendar overlay** has only a slot (`calendar-overlay.ts`) for feature 12.
- Not tested on a real phone or in Safari or Firefox; the 360px layout is checked in Chromium only. The Docker build was not run.

## Related files

- `src/lib/views/`: the engine. `engine.ts` (`runView`), `filter.ts`, `sort.ts`, `group.ts`, `properties.ts` (the property registry), `values.ts` and `due-buckets.ts` (`dueBucketFor`, one clock per run), `defaults.ts` (`defaultConfig`), `move-card.ts` (`planMove`, `dateForBucket`), `patch.ts` (what a command shows before the server answers), `calendar.ts`, `scope.ts` (when finished or archived items are read), `legacy.ts` (`parseViewParam`, `pickView`, cookie name), `quick.ts` (the V1 filter chips merged over a view).
- `src/lib/validations/views.ts`: `viewConfigSchema(collection)`; `readViewConfig` falls back to the default and sets `configReset`.
- `src/db/schema/views.ts`, `drizzle/migrations/0007_collection-views.sql`; `src/db/queries/views.ts` (`getViews`, `loadViewItems`); `src/db/mutations/views.ts` (CRUD, `ensureDefaultViews`, `ensureGalleryView`); `src/actions/views.ts`.
- `src/components/views/`: `collection-host.tsx` (tabs, settings, optimistic patches), `use-view-config.ts`, `board-view.tsx`, `table-view.tsx`, `table-cells.tsx`, `calendar-view.tsx`, `list-views.tsx`, `bulk-bar.tsx`, `commands.ts` (`runCommands`, Undo), `apply.ts`, `dnd.tsx` + `dnd-nodes.tsx` (the only files that touch dnd-kit), `collections.tsx` (`TasksCollection`, `TodosCollection`, `NotesCollection`).
- Pages: `src/app/(app)/tasks/page.tsx`, `notes/page.tsx`, `projects/[id]/page.tsx`.
- Tests: `tests/unit/views-*.test.ts`, `tests/integration/views.test.ts`, `e2e/views.spec.ts`, `e2e/views-more.spec.ts`.

## Hand-off notes

- **Do not call a provider or write a new mutation for a drop.** Add a `MoveCommand` (`move-card.ts`), its patch (`patch.ts`) and its runner (`commands.ts`), and reuse the Server Action.
- **dnd-kit lives in `dnd.tsx` and `dnd-nodes.tsx` only.** `dnd-nodes.tsx` has a file-level lint disable for `react-hooks/refs` (the library hands out refs during render). Keyboard drag lifts on Space only (Enter opens an item) and arrows jump to the nearest column or card (`jumpToNeighbour`).
- **Saving settings:** `useViewConfig` keeps a local copy and saves after 500 ms. It refreshes the page only when the *scope key* changes (whether finished or archived items must be read). It adopts the server's copy when the view prop's version changes and nothing is unsaved. A router refresh during a drag can cancel the drag; tests wait for the save first.
- **Quick filters stay in the URL** (status, due, project, tag, archived) and are merged over the view's own filters for display (`withQuickFilters`); they are not written into the view.
- **A Board always has a group-by**; a view with none is shown by the first option (`collection-host.tsx`).
- **The `none` day key** on the calendar means "No date"; never pass it to a date function.
- **Notes order:** List defaults to `updated` descending; Board columns and any view with no sorts use `sort_order`. `reorderNote` does not touch `updated_at`.
- **Dev database:** run `pnpm db:migrate` before opening the app (the test database is migrated by the E2E run).
- **Toasts stack:** in E2E, click Undo inside `[data-sonner-toast][data-front="true"]`.
- Related: `tasks-and-todos_v1.md`, `notes-projects-tags_v1.md`, `ui-modernization_v1.md` (DESIGN.md rules), ADR `docs/decisions/0008-drag-and-drop-library.md`.
