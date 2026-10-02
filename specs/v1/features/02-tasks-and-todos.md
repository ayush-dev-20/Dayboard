# Feature 02 — Tasks & Todos

## 1. Scope

- Tasks: create, edit, complete/uncomplete, status, priority, dates, subtasks (one level), recurrence, archive, soft delete and restore
- Task detail: side sheet on desktop, full page on mobile, rich-text description
- **Shared rich-text editor component** (Tiptap). Built here because task descriptions are its first use, and reused by Notes in feature 03.
- Todos: lightweight checkbox items, separate from tasks
- Emoji on tasks and todos
- `/tasks` page with a **Tasks | Todos** switch

Project assignment UI is a disabled placeholder until feature 03. The `project_id` column exists from the start, so no migration is needed later.

Source spec sections: product §6.3–6.5, §6.12; technical §5, §6, §11, §12; UI/UX §8, §9, §12, §18; project plan Phase 2.

---

## 2. Data model

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `project_id` | uuid NULL FK → projects, `ON DELETE SET NULL` | FK added in feature 03 migration. Same-user check in code. |
| `parent_task_id` | uuid NULL FK → tasks, cascade | Parent must have `parent_task_id IS NULL` (one level only) and the same user |
| `title` | text NOT NULL | 1–500 chars, trimmed |
| `emoji` | text NULL | one grapheme |
| `description_json` | jsonb NULL | Tiptap JSON (canonical) |
| `description_text` | text NULL | plain-text projection for search and AI |
| `status` | enum `INBOX, PLANNED, IN_PROGRESS, WAITING, DONE, CANCELLED` | default `PLANNED` (or `INBOX` when created from Inbox conversion) |
| `priority` | enum `NONE, LOW, MEDIUM, HIGH` | default from `user_preferences.default_task_priority` |
| `due_date` | date NULL | Refines product spec `dueAt`, see §3 |
| `due_time` | time NULL | only valid when `due_date` is set |
| `start_date` | date NULL | |
| `start_time` | time NULL | |
| `completed_at` | timestamptz NULL | set if and only if status is `DONE` |
| `recurrence_rule` | text NULL | RRULE subset, see §5 |
| `recurrence_parent_id` | uuid NULL | the series' first task, for history. Not an FK constraint. |
| `sort_order` | double precision NOT NULL | |
| `created_at`, `updated_at` | timestamptz | |
| `archived_at` | timestamptz NULL | |
| `deleted_at` | timestamptz NULL | |

Check constraints:
- `(status = 'DONE') = (completed_at IS NOT NULL)`
- `due_time IS NULL OR due_date IS NOT NULL`, same for start
- `parent_task_id <> id`

Indexes (technical spec §6): `(user_id, status)`, `(user_id, due_date)`, `(user_id, updated_at)`, `(user_id, deleted_at)`, `(user_id, project_id)`, `(parent_task_id)`.

### `todos`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `project_id` | uuid NULL FK → projects, `ON DELETE SET NULL` | FK added in feature 03 |
| `title` | text NOT NULL | 1–300 chars |
| `emoji` | text NULL | |
| `is_complete` | boolean NOT NULL default false | |
| `completed_at` | timestamptz NULL | set if and only if `is_complete` |
| `due_date` | date NULL | date only. Todos have no times. |
| `sort_order` | double precision NOT NULL | |
| `created_at`, `updated_at`, `archived_at`, `deleted_at` | timestamptz | |

Indexes: `(user_id, is_complete, sort_order)`, `(user_id, due_date)`, `(user_id, project_id)`, `(user_id, deleted_at)`.

Todos deliberately have no tags, subtasks, priority, description or links (product spec §6.4).

---

## 3. Dates and time zones

The product spec lists `dueAt`/`startAt`. They're stored as **local date + optional local time** instead of a single timestamp:

- "Due today" means *the user's calendar date*. A `timestamptz` for an all-day task would shift days if the user changes timezone or travels.
- All date math runs in `user_preferences.timezone` with `start_of_day` as the rollover (default 06:00, so a task due "today" is still today at 1 a.m.).
- One helper module, `src/lib/dates/`, owns this. It exposes `getUserToday(prefs)`, `isOverdue(task, prefs)` and `isDueToday(task, prefs)`. Uses `date-fns` + `@date-fns/tz`. No other date library.
- Overdue: `due_date < today`, or `due_date = today AND due_time < now`, and status not in `DONE, CANCELLED`.

---

## 4. Status rules

| Action | Effect |
|---|---|
| Complete | `status = DONE`, `completed_at = now()`. Returns `previousStatus` so the Undo toast can restore it. |
| Undo complete (toast) | `status = previousStatus`, `completed_at = NULL` |
| Uncomplete (later, from completed list) | `status = PLANNED`, `completed_at = NULL` |
| Cancel | `status = CANCELLED`. Not counted as completed. |
| Complete parent with open subtasks | Allowed. Subtasks are not auto-completed. The toast says "2 subtasks still open". |
| Subtask | Has its own status. Can't have subtasks, recurrence or a separate project (inherits the parent's `project_id`). |

Status transitions live in pure functions in `src/lib/tasks/status.ts` (unit tested). Actions call them. No status logic in components.

---

## 5. Recurrence

The simple repeat selector offers these presets, stored as an RFC 5545 RRULE subset:

| Preset | Stored rule |
|---|---|
| Daily | `FREQ=DAILY` |
| Weekdays | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| Weekly on [days] | `FREQ=WEEKLY;BYDAY=…` |
| Every N days/weeks | `…;INTERVAL=N` (N 1–30) |
| Monthly on day D | `FREQ=MONTHLY;BYMONTHDAY=D` (31 → last day of short months) |
| Yearly | `FREQ=YEARLY` |

- A recurring task **must have a `due_date`**.
- On completion, the server, in the same transaction, creates the next occurrence: it copies title, emoji, description, priority, project, tags and time, sets the next `due_date` computed from the **previous due date** (not today), status `PLANNED`, and copies subtasks as open. The completed instance keeps its rule set to NULL, and the new one carries the rule.
- Undoing the completion deletes the generated occurrence, provided it hasn't been edited since.
- The next-date calculation is a pure function in `src/lib/tasks/recurrence.ts`, implemented with date-fns. No `rrule` dependency, since only these presets are supported. Anything unparseable is rejected with `VALIDATION_ERROR`.

---

## 6. Shared rich-text editor

Component: `src/components/editor/RichTextEditor.tsx` (client), loaded with `next/dynamic` and `ssr: false`, with a skeleton fallback.

- Extensions: StarterKit (paragraph, headings 1–3, bold, italic, strike, bullet/ordered list, blockquote, code block, inline code, horizontal rule, undo/redo) + Underline + Link + TaskList/TaskItem (checklist). No image or file extensions.
- Props: `initialContent`, `onChange(json)`, `placeholder`, `variant: "compact" | "document"`. Task descriptions use `compact` (smaller min-height, bubble menu only). Notes use `document` (toolbar + bubble menu).
- Link extension: `http`, `https` and `mailto` only, with `rel="noopener noreferrer nofollow"`.
- `src/lib/editor/projection.ts`: `toPlainText(json)` builds the projection **on the server** from the submitted JSON. The client never supplies `*_text`.
- `src/lib/editor/schema.ts`: Zod validation of incoming Tiptap JSON. Only allowed node and mark types, max 200 KB serialized, max depth 20. Rejects unknown nodes.
- Task description autosave: 800 ms debounce, saving/saved indicator. Uses the same autosave hook as Notes (`useAutosave`, defined here).

---

## 7. Server contract

`src/actions/tasks.ts` and `src/actions/todos.ts`. Every action: `requireUser()` → Zod parse → ownership-scoped query → `revalidatePath` of affected routes.

### Tasks

| Action | Input | Returns |
|---|---|---|
| `createTask` | `{ title, emoji?, parentTaskId?, projectId?, status?, priority?, dueDate?, dueTime?, recurrenceRule? }` | task |
| `updateTask` | `{ id, ...partial editable fields }` | task |
| `updateTaskDescription` | `{ id, descriptionJson }` | `{ updatedAt }` |
| `completeTask` | `{ id }` | `{ task, previousStatus, nextOccurrenceId? }` |
| `setTaskStatus` | `{ id, status }` | task |
| `reorderTask` | `{ id, beforeId?, afterId? }` | `{ sortOrder }` (midpoint of neighbours, renormalize the list when gaps < 1e-9) |
| `archiveTask` / `unarchiveTask` | `{ id }` | task |
| `deleteTask` | `{ id }` | soft delete. Subtasks share the same `deleted_at`. |
| `restoreTask` | `{ id }` | restores the task and subtasks that share its `deleted_at`. Clears `project_id` if the project is deleted. |
| `permanentlyDeleteTask` | `{ id }` | only when `deleted_at IS NOT NULL`. Called from Trash (feature 04). |

### Todos

`createTodo`, `updateTodo`, `toggleTodo` (returns the previous value for undo), `reorderTodo`, `archiveTodo`, `deleteTodo`, `restoreTodo`, `permanentlyDeleteTodo`. Same patterns.

### Queries (`src/db/queries/tasks.ts`, `todos.ts`)

- `listTasks(userId, filters)`. Filters: `status[]`, `projectId`, `due: overdue|today|upcoming|none`, `includeCompleted`, `archived`. Top-level tasks with subtask counts (single query, no N+1).
- `getTaskDetail(userId, id)`: task + subtasks (+ related notes and tags added by feature 03).
- `listTodos(userId, filters)`: open first, then completed today.

---

## 8. UI

### `/tasks`

- Header segmented control: **Tasks | Todos**, kept in the URL (`?view=todos`) so it survives refresh.
- Tasks view: inline "Add task" row at the top (Enter creates, keeps focus for the next one). Filters in the URL. Default grouping: Overdue, Today, Upcoming, No date. Completed collapsed at the bottom.
- `TaskRow` (UI/UX §8): checkbox, emoji + title, due chip (red text + icon when overdue, never colour alone), priority icon, project token, subtask count "1/3", overflow menu (move to trash lives here).
- Todos view: `TodoRow` is a checkbox, emoji, title, optional due chip and overflow. That's all. Inline add at the top.
- Keyboard: `N` new task, `T` new todo (when not typing), ↑/↓ move focus between rows, `Space` toggles, `Enter` opens task detail, `Alt+↑/↓` reorders.

### Task detail

- Desktop ≥ 1024px: `TaskDetailSheet`, a docked, non-modal panel on the right, 480px by default (the list stays usable beside it; design `Tasks_and_Todos.html`), URL `/tasks?task=<id>` so it's linkable and the Back button closes it. A narrower window turns that URL into the full page.
- The panel is **resizable** (drag the left edge or use ←/→ on the focused handle; 360–960px, the list never under 420px; width remembered in `localStorage`; double-click or Home resets), **expandable** (fills the content area; Restore returns it) and **minimizable** (a small bar at the bottom right with the title, Restore and Close; the task stays open). Esc steps back from expanded to docked, then closes. Choosing another task or closing returns it to docked. State lives in `src/components/tasks/sheet-state.ts`.
- Mobile/tablet: full page at `/tasks/<id>`.
- Layout per UI/UX §9: emoji picker + title (inline editable), status / priority / due / start / repeat / project row, subtasks (inline add, one level), description (`RichTextEditor` compact), related notes (feature 03), AI actions (feature 05).

### Emoji picker

- `EmojiPicker` component, shared by tasks, todos and notes: a Popover on desktop, a bottom Sheet on mobile. Includes search, recent emojis (per-browser `localStorage`, wrapped in try/catch) and "Remove".
- Use `frimousse` (headless, small, unstyled, fits shadcn). Checked: it supports React 19, so no fallback was needed. Its emoji data is served from our own origin, not a CDN (ADR 0002).
- Emoji renders before the title in rows, detail headers and search results, with `aria-hidden="true"` (it's decoration; the title carries meaning).

### Optimistic UI

*As built:* the checkbox shows the result at once from local state (`useOverride`), not `useOptimistic`, and the row stays in place until the Undo toast closes, then the list refreshes. Complete/uncomplete, todo toggle and reorder are optimistic. On failure: revert, then show an error toast with Retry. The Undo toast lasts 5 seconds. Deletion is not optimistic (technical spec §11).

---

## 9. Tests

**Unit**
- Status transition functions, including the `DONE ⇔ completed_at` invariant
- Recurrence next-date for every preset, including month-end (Jan 31 → Feb 28/29), DST boundaries and interval > 1
- `isOverdue` / `isDueToday` across time zones and `start_of_day`
- One-level subtask rule (can't nest under a subtask, can't parent itself)
- Tiptap JSON schema rejects unknown nodes, oversize and too-deep input. Projection output is correct.
- Emoji validator: accepts ZWJ sequences and skin tones, rejects two emojis and plain text

**Integration** (added in the build): `tests/integration` calls the real actions on a test database, including a table-driven ownership check on every task and todo action.

**E2E**
1. Create task → edit title, priority, due → complete → Undo → complete again → persists after reload
2. Subtasks: add two, complete one, count shows 1/2
3. Recurring daily task: complete → next occurrence appears with tomorrow's date
4. Task description: type rich text → reload → formatting preserved
5. Delete task with subtasks → gone from list (Trash UI verified in feature 04)
6. Todos: create, set emoji, toggle, reorder, delete
7. Mobile viewport: opening a task shows the full-page detail
8. Ownership: user B gets `NOT_FOUND` for user A's task ID on every task and todo action

---

## 10. Definition of done

- [ ] A user can manage tasks and todos daily without Notes or AI (project plan Phase 2)
- [ ] Recurring tasks roll forward correctly
- [ ] Rich-text description survives reload. Projection is built on the server.
- [ ] Emoji can be set and removed on tasks and todos
- [ ] Optimistic complete/toggle with revert on failure
- [ ] Works at 360px with touch, and fully keyboard-operable on desktop
- [ ] All actions ownership-checked and covered by tests

---

## 11. Out of scope (V1)

- Drag-and-drop ordering (keyboard/button reordering is enough; add dnd-kit later only if needed)
- Custom recurrence beyond the presets, "repeat after completion" mode
- Subtask nesting beyond one level
- Converting a todo into a task and back (possible V2 convenience)
- Reminders/notifications

- **Task panel (2026-10-02):** resize, expand and minimize were added to the docked panel (§8 Task detail); covered by the "the task panel" E2E scenarios.
