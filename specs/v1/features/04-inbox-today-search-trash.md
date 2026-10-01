# Feature 04 — Inbox, Today, Search & Trash

## 1. Scope

These are the four views that span every item type:

- **Inbox / Quick Capture:** capture unstructured text in seconds, convert it later
- **Today:** the default landing page and daily overview
- **Search:** Cmd/Ctrl+K command menu + `/search` page, lexical and user-scoped
- **Trash:** one place to restore or permanently delete tasks, todos, notes, projects and inbox items

No AI in this feature. Every view here must be fully useful without it (Agent.md §26). Feature 05 plugs AI into the slots defined here.

Source spec sections: product §6.2, §6.9, §6.11, §9, §11 Journeys B–C; technical §6, §10; UI/UX §7, §10, §11, §14–16; project plan Phases 6–8.

---

## 2. Data model

### `inbox_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `text` | text NOT NULL | 1–5,000 chars |
| `status` | enum `OPEN, CONVERTED, ARCHIVED` | default `OPEN` |
| `converted_at` | timestamptz NULL | |
| `converted_refs` | jsonb NULL | e.g. `[{ "type": "task", "id": "…" }, { "type": "note", "id": "…" }]`, used to show "Converted to…" links |
| `ai_suggestion` | jsonb NULL | written by feature 05. The column is declared here to avoid a later migration. |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Index: `(user_id, status, created_at DESC)` (technical spec §6), `(user_id, deleted_at)`.

`user_preferences.focus_task_id` (declared in 01) stores Today's focus.

No new tables for Search or Trash. They query existing tables.

---

## 3. Inbox / Quick Capture

### Capture entry points

| Entry | Behavior |
|---|---|
| **Cmd/Ctrl+K** → command menu | Typing always shows a first action row: **"Capture '<text>' to Inbox"**. `Cmd/Ctrl+Enter` picks it from anywhere in the menu. |
| **`C` key** (not typing) or the top-bar Quick Capture button | Opens the command menu directly in Capture mode (single textarea, UI/UX §10) |
| Inbox page | Inline textarea at the top |
| Today page | Quick capture input |

This settles an overlap in the source specs, which assign Cmd/Ctrl+K to both Search and Quick Capture. One menu does both: Search/Ask/Create modes (UI/UX §14), with capture always one keystroke away.

Capture is **optimistic**: the item appears immediately, `Esc` closes, and a failure keeps the text in the input with a Retry. Target: menu opens → typed → saved in under 10 seconds (project plan Phase 6).

### Conversion

The `/inbox` list shows open items (newest first): text, relative time, AI suggestion slot (feature 05), and actions **Convert ▾ / Archive / Delete**.

Convert opens a small dialog with editable pre-filled fields. The user always confirms.

| Target | Pre-fill | Creates |
|---|---|---|
| Task | title = first line (≤ 500), rest → description | task, `status = PLANNED` (or `INBOX` if "Decide later" is ticked) |
| Todo | title = first line (≤ 300) | todo |
| Note | title = first line, full text → body paragraph(s) | note |
| Task + note | task title = first line; note body = full text | task + note + `task_notes` link |
| Project idea | name = first line (≤ 100), rest → description | project with `status = ON_HOLD` |

Every conversion also offers an optional project, and for task/todo a due date. `convertInboxItem` runs in **one transaction**: create target(s) → set `status = CONVERTED`, `converted_at`, `converted_refs`. A converted item leaves the Open list and appears under a collapsed "Recently converted" section (last 7 days) with links to what it became.

### Server contract (`src/actions/inbox.ts`)

`captureInboxItem({ text })`, `updateInboxItem({ id, text })`, `convertInboxItem({ id, target, fields })` (discriminated-union Zod schema per target), `archiveInboxItem`, `unarchiveInboxItem`, `deleteInboxItem` (soft), `restoreInboxItem`, `permanentlyDeleteInboxItem`.

---

## 4. Today

Route: `/today`, the default after sign-in. A Server Component with one data loader, `getTodayData(userId)`, that uses the `src/lib/dates` helpers with the user's timezone and `start_of_day`.

### Sections (in order)

| Section | Content | Limit |
|---|---|---|
| Header | "Good morning/afternoon/evening, {first name}" + local date | |
| Focus | The task in `focus_task_id`, with [Change focus] (task picker) and [Clear]. Auto-clears if that task is completed, deleted or cancelled. Empty state: "Pick one thing to focus on". | 1 |
| Overdue | Open tasks with `due_date < today` (or earlier today with a passed `due_time`) | 10, then "Show all" → `/tasks?due=overdue` |
| Today | Open tasks due today with no time, then **Scheduled later today** (has `due_time`, ascending) | 20 |
| Todos | Open todos due today or overdue, then undated open todos | 10 |
| Needs planning | Undated open tasks with priority `HIGH`/`MEDIUM`, not in a WAITING state | 5 |
| Recently updated notes | By `updated_at` | 5 |
| Completed today | Tasks and todos completed since today's `start_of_day`, collapsed | 20 |
| AI suggestion | Slot for feature 05. Renders nothing when AI is disabled or unavailable. | |

Product spec §6.2 "Suggested focus" maps to the Focus card plus Needs planning. The AI may later *suggest* a focus, but never sets it (UI/UX §7).

- Reuses `TaskRow`, `TodoRow` and `NoteCard`. Completing a task here behaves exactly as on `/tasks` (optimistic + Undo).
- Empty day: "Your day is clear. Capture a task or start a note. [New task] [New note]" (UI/UX §16).
- One round-trip: all sections come from parallel queries in the loader. No client fetching.

---

## 5. Search

### Query rules

- Implementation: `src/lib/search/` with PostgreSQL `ILIKE` on bounded fields (technical spec §6). User input is escaped for `%`, `_` and `\`. Minimum 2 characters, maximum 200.
- Always scoped `user_id = :uid AND deleted_at IS NULL`. Archived items are included but labelled.
- Searched fields (product spec §6.11): task title + description_text, todo title, note title + content_text, project name, tag name (a tag match returns the tag and lists its tasks/notes).
- Ranking: exact title match > title prefix > title contains > body contains. Ties broken by `updated_at DESC`. Implemented as a `CASE` score in SQL. Pure ranking helpers are unit tested.
- Snippets: a ~120-char window around the first body match, returned as `{ before, match, after }` **text segments** and rendered as text with `<mark>`. Never as HTML.
- Performance: the command menu fetches the top 5 per type through a Route Handler `GET /api/search?q=` (client needs debounced fetches as the user types; 150 ms debounce, aborted on the next keystroke). If profiling shows `ILIKE` is slow, add `pg_trgm` GIN indexes. That's a migration only; the API doesn't change.

### Filters (`/search` page)

Type (All / Tasks / Todos / Notes / Projects), task status, project, tag, and a date range. The date range applies to `due_date` for tasks/todos and `updated_at` for notes/projects, labelled "Due / updated". All filters live in URL params.

### Command menu (`CommandMenu`, built on `cmdk`)

- Modes: **Search** (default), **Ask** (feature 05, hidden until then), **Create** (new task / todo / note / project, capture).
- Results grouped by type. Emoji and project token are shown.
- Keyboard: ↑/↓, Enter opens, `Cmd/Ctrl+Enter` captures, Esc closes, `Tab` switches mode.
- With no query: recent searches (localStorage, last 8, try/catch) + quick actions + recent items.
- Desktop: centered dialog. Mobile: full-screen sheet.

---

## 6. Trash

Route: `/trash`.

- Lists soft-deleted **top-level** items across `tasks` (subtasks travel with their parent), `todos`, `notes`, `projects` and `inbox_items`, newest deletion first.
- Row: type icon + label, emoji + title, deleted date, [Restore], overflow → [Delete permanently].
- Filter by type. Paginated at 50.
- **Delete permanently:** `ConfirmDialog` ("This can't be undone"). Never optimistic.
- **Empty trash:** `ConfirmDialog` showing the item count. Runs in one transaction per type.
- Restore calls the owning feature's `restore*` action, so restore rules stay in one place (e.g. a restored task whose project is still in Trash shows as "No project" until that project is restored, per feature 03 §3).
- Toasts: "Restored. [Open]", "Deleted permanently".
- No automatic purge in V1 (product spec §9).

Query: `listTrash(userId, { type?, cursor })`, a `UNION ALL` over the five tables that selects `(type, id, title, emoji, deleted_at)`.

---

## 7. Tests

**Unit**
- Search input escaping (`%`, `_`, `\`), ranking order, snippet windowing including multibyte text
- Today bucketing across time zones and `start_of_day` (a task due today at 01:00 local with `start_of_day = 06:00` still counts as today)
- Conversion field derivation (first line / rest, truncation)

**E2E**
1. Journey B: `Cmd/Ctrl+K` → type → `Cmd/Ctrl+Enter` → item in Inbox → Convert to task + note → both exist and are linked, and the inbox item shows under "Recently converted"
2. Convert to todo, note and project idea
3. Today: seeded overdue, today, timed and completed items land in the right sections. Set focus → complete it → focus clears.
4. Search: finds a task by description text, a note by body text and a project by name. Keyboard navigation opens the result.
5. Search isolation: user B's matching note never appears for user A
6. Trash: delete one of each type → all listed → restore a task with subtasks → subtasks back → delete a note permanently → gone after reload
7. Empty-state rendering for Today, Inbox and Trash

---

## 8. Definition of done

- [ ] Capture takes under 10 seconds from any screen
- [ ] Every conversion target works and is transactional
- [ ] Today is useful with AI switched off (project plan Phase 7)
- [ ] Search finds tasks, todos, notes, projects and tags, with keyboard navigation and no cross-user leakage
- [ ] Trash restores and permanently deletes every item type
- [ ] All four views work at 360px

---

## 9. Out of scope (V1)

- Semantic/vector search, fuzzy matching beyond ILIKE (optional `pg_trgm` only if profiling demands)
- Automatic trash purge
- Saved searches
- Email-to-inbox, browser-extension capture
