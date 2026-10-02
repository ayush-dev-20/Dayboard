# Feature: Tasks & Todos

**Phase:** V1
**Status:** Done (code, tests and docs). Docker was not run; see "Not verified".
**Date:** 2026-10-01

## What was built
- Tasks: status, priority, due and start date/time, one-level subtasks, repeat (daily, weekdays, weekly with days, every N weeks, monthly, yearly), rich-text description, emoji, keyboard and menu reordering, archive, trash with Undo. The list is grouped Overdue / Today / Upcoming / No date with a collapsed Completed section; filters live in the URL.
- Todos: a separate light type (round checkbox, emoji, title, optional date). No subtasks, priority, tags or description.
- The shared pieces other features reuse: `RichTextEditor` (Tiptap), `EmojiButton` (frimousse), `useAutosave`, `useOverride`, `CheckButton`, and the pure task logic in `src/lib/tasks/`.
- Tests: 221 unit, 63 integration (real actions, real database), 92 Playwright (desktop and phone), all passing. A production build was made by the Playwright run.

## Why
Tasks and todos are the daily-use core, so everything here has to be quick and safe: every mutation is one transaction scoped to the signed-in user, and recurrence, ordering and status rules are pure functions with their own tests.

## What was deferred
- Project, tags and related notes on a task: done in feature 03 (`notes-projects-tags_v1.md`), which also added the `project_id` foreign key.
- Trash screen, Inbox, Today content, search and Quick capture / Create: built in feature 04 (`inbox-today-search-trash_v1.md`). AI actions on a task: feature 05.
- Drag and drop (not wanted in V1), custom repeat rules, turning a todo into a task (V2).

## Related files
- `src/db/mutations/tasks.ts`, `todos.ts`: all writes (transactions, owner id in every WHERE, `FOR UPDATE` on complete/undo). `src/db/queries/`: reads. `src/actions/`: thin Server Actions.
- `src/lib/tasks/`: `status`, `recurrence`, `ordering`, `subtasks`, `grouping`, `params` (URL ↔ filters). `src/lib/dates/today.ts`: what "today" and "overdue" mean.
- `src/lib/editor/`: `sanitizeDoc` (whitelist, size and depth caps) and `toPlainText` (the server-built projection). The client never sends text columns.
- `src/components/tasks/`: rows, list, detail panel and page, pickers, add rows. `src/components/editor/`, `src/components/emoji/`.
- `src/app/(app)/tasks/page.tsx`, `[id]/page.tsx`. `drizzle/migrations/0001_tasks-and-todos.sql`.
- `tests/integration/` (harness mocks only session, `next/cache`, headers, navigation), `e2e/tasks.spec.ts`, `todos.spec.ts`.

## Hand-off notes
- **Completing does not revalidate.** The row must stay put during the 5-second Undo toast; the client calls `router.refresh()` when the toast closes. Same for todo toggles and description autosave. Don't "fix" this by adding `revalidatePath`.
- **Recurrence:** completing a repeating task creates the next one in the same transaction, dated from the old due date, and sets the finished task's rule to NULL. Undo removes the next one only if it is unedited (`updated_at == created_at`).
- **Dates are `YYYY-MM-DD` strings plus optional `HH:MM`**, not timestamps. "Today" rolls over at the person's `start_of_day`. All date math goes through `src/lib/dates/`.
- **Ordering** is a float `sort_order` (midpoint inserts, renumber below 1e-9 gaps). `reorder`: `beforeId` is the neighbour above, `afterId` the one below.
- **Detail view:** docked non-modal panel at `/tasks?task=<id>` from 1024px up, full page `/tasks/<id>` below (the panel URL redirects on a narrow window). Saves in the detail run one at a time and the last answer wins, so tapping several weekdays quickly can't overwrite itself.
- **Emoji data is self-hosted** (`public/emojibase`, copied by `predev`/`prebuild`, git-ignored) so the picker never calls a CDN. See ADR 0002. Picker cells are `gridcell`s named by label ("Rocket").
- **Drizzle:** inside a single-table query `${tasks.id}` prints as a bare `"id"`; correlated subqueries write `"tasks"."id"` by hand (the subtask counts depend on it).
- **Build output folders must start with `.next-`** and be git-ignored: Tailwind scans everything not ignored, and a build writing into a scanned folder garbles a running `next dev`. E2E builds into `.next-e2e` (`NEXT_DIST_DIR`), port 3100.
- **E2E conventions:** time zone is pinned to Asia/Kolkata; the web server's Google/GitHub keys are blanked so a developer's `.env.local` can't change results; each test uses its own fake IP. On a Mac, Home/End scroll the page, so tests select text with Shift+Arrow.
- The Cancelled badge is inside the row's title button, so its accessible name is "<title> Cancelled".
- `pnpm db:seed` also gives the demo user sample tasks and todos (only if they have none).
- **Checklists in task descriptions** now save their ticked state (feature 03 fixed a bug where it was lost; see its hand-off notes).
- **Task panel states (added later):** the docked panel can be dragged wider or narrower (360–960px, remembered in `localStorage`), expanded to fill the content area, or minimized to a bar at the bottom right. State is a small external store (`components/tasks/sheet-state.ts`, `useSyncExternalStore`) so the panel and the list beside it (`TaskListShell`) agree without props; Esc goes expanded → docked → closed; `useOpenTask`/`useCloseTask` reset it to docked. Task rows use container queries, so project and tag chips hide when the list is narrow. `DESIGN.md` and the UI/UX spec describe it; the HTML in `designs/` was not regenerated.
- **Design vs spec:** the design shows the detail as a docked panel, spec 02 said "side sheet"; the design was followed (spec updated).

## Not verified
- Touch behaviour on a real phone (only emulated), and Safari/Firefox (Chrome only).
- `Dockerfile` / Compose with the new build step (`prebuild` copies emoji data): Docker is not installed here.
