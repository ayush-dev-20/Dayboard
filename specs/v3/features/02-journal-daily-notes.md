# Feature 02 — Journal (Daily Notes) (V3)

> **Build priority: second V3 feature** (owner, 2026-10-13), after the canvas (01). It needs only V1 and the V2 notes work that is already built. Behaviour is in V3 product spec §5; where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- A **Journal** sidebar tab (not part of the Today page): one **entry per day**, written in the **same editor and the same page component as a note**.
- The **add button** opens today's entry, with its title already filled in as the date and day.
- A read-only **Done on this day** section in every entry, listing the tasks and todos completed that day.
- A collapsible sidebar section listing the latest entries, folding like Projects and Notes.
- A Journal page (`/journal`) listing entries by month, with a Today row.
- An optional **starting template** for new entries (the link is added when feature 03 lands).

Reuses: the whole note stack (`notes` table, `NoteEditor`, `RichTextEditor`, `useAutosave`, save state, conflict banner, device draft, tags, project, links and backlinks, files, Ask / Update with AI, Trash, archive, search), the sidebar fold (`useSidebarSection`), `src/lib/dates/` (time zone and start of day), `completed_at` on tasks and todos, `appendDoc` from `src/components/editor/ai-apply.ts` for "Add to entry".

Packages: none.

Source spec sections: V3 product §5, `../Agent.md` §3 (modules) and §9 (migrations), V1 `../../v1/Agent.md` (server and client boundaries), V1 UI/UX spec (sidebar, mobile).

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Migration, journal queries and the Notes filters, `/journal/today`, the entry page on the note editor, the add button, Journal page, sidebar section | A person can write a daily entry |
| **B** | Done on this day, Add to entry | The entry lists what was finished |
| **C** | Starting template (needs feature 03) | New entries start from the person's layout |

Slices A and B ship together; C waits for 03.

---

## 2. Data model

A journal entry is a **note that carries a date**. No new table.

### `notes` (changed)

| Column | Type | Notes |
|---|---|---|
| `journal_date` | `date` NULL | The calendar day the entry belongs to, in the person's own time zone and start of day. Set by the server. NULL for every ordinary note |

Constraints and indexes (one **expand-only** migration):

- Unique index `notes_user_journal_date_idx` on `(user_id, journal_date)` **where `journal_date is not null and deleted_at is null`**: at most one live entry per person per day.
- Check: `journal_date is null or (parent_note_id is null and depth = 1)`: an entry is always a top-level note (§3).
- No backfill: every existing note keeps `journal_date = null`.

### Indexes that serve "Done on this day"

New partial indexes (expand-only), because the Done query filters by person and completion time:

- `tasks (user_id, completed_at) where completed_at is not null`
- `todos (user_id, completed_at) where completed_at is not null`

If the database already has an equivalent index, reuse it. Check the query plan at build time; do not add an index the plan does not use.

### What the day is

`journal_date` is a calendar date string `YYYY-MM-DD`. "Today" is `getUserToday(prefs)` from `src/lib/dates/today.ts` (person's time zone, start of day, default 06:00). The server computes it; **no action takes a date from the browser**.

New pure helpers in `src/lib/dates/journal.ts`:

- `journalTitle(date: string): string` returns `Tuesday, 13 October 2026`. It formats the date string as a UTC calendar date (never as local midnight, which shifts a day in some time zones) with weekday, day, month and year assembled by parts, so the shape does not depend on the runtime's locale data.
- `dayBounds(date: string, prefs: DayPrefs): { start: Date; end: Date }` returns the instants a day covers: from the day's start-of-day in the person's time zone to the next day's. It is correct across daylight-saving changes (a 23- or 25-hour day).

---

## 3. What an entry is, and is not

An entry is a note in every way except these:

| Difference | Rule |
|---|---|
| Date | One live entry per day (§2) |
| Title | Filled in as `journalTitle(date)`; editable; the date is stored separately so a rename never moves the entry |
| Place | Shown in Journal, **not** in the Notes list, the Notes tree, Boards, Table, Gallery or the "Move to" dialog |
| Position | Top level only. It cannot be moved under another note, and the **sub-note block is not offered** inside it (open question in the product spec) |
| Extra section | **Done on this day** (§5) |
| Page chrome | Back goes to Journal; the breadcrumb is "Journal"; no "Move to" |

**Where entries are still found** (the rule: they appear wherever a note is reached by relationship or search, and are left out wherever notes are browsed as the Notes collection):

- Included: global search (labelled **Journal**, opens `/journal/{id}`), Trash and its restore, the assistant's tools, backlinks, a project's page (if the entry has a project), a tag's page, the note pickers used to link a task or a note (shown with a calendar glyph and the date).
- Excluded: `/notes` list, the sidebar tree, saved views of notes, the "Move to" dialog, sub-note creation targets, the Notes count.

Implement the exclusion **in one place**: a shared query condition `plainNotes` (`journal_date is null`) and its counterpart `journalEntries`, exported from `src/db/queries/notes.ts`, used by every query that lists notes. A test lists every exported note query and states whether it uses `plainNotes`, so a new query cannot forget the choice.

---

## 4. Server contract

Actions in `src/actions/journal.ts` (each starts with `requireUser()`, Zod input, `runAction`):

| Action | Purpose |
|---|---|
| `createJournalEntry({ title?, contentJson? })` | Creates **today's** entry. The server computes the date. If a live entry for that date exists (two tabs, or an entry made on another device) it returns `{ outcome: "exists", id }` and creates nothing. Content is checked with the note's `sanitizeDoc`; the text copy is built on the server. Called from the editor on the first edit, exactly as `createNote` is for a new note |
| `getTodayJournalTarget()` | Returns `{ date, entryId \| null, doneCount }` for the Today row and the add button |

Everything else about an entry (`saveNoteContent`, `saveNoteTitle`, `updateNoteMeta`, `archiveNote`, `deleteNote`, `restoreNote`, tags, project, links) is the **existing note action**, unchanged. They already check ownership; they must also refuse to set `parent_note_id` on an entry or change `journal_date`. `journal_date` is never writable through any note action.

Restoring an entry from Trash when another live entry now holds its date returns `CONFLICT` ("There is already an entry for that day. Open it, or delete it first."). Permanently deleting frees the date.

Queries (`src/db/queries/journal.ts`):

- `listJournalEntries(userId, { cursor, limit })`: newest first by `journal_date`, with title, first line (the text copy, cut), `journal_date`, `emoji`, archived flag, and `doneCount` per entry.
- `getJournalEntry(userId, id)`: the note DTO plus `journal_date`.
- `getDoneOnDay(userId, date, prefs)`: the tasks and todos completed in `dayBounds(date, prefs)`:
  - tasks: `status = 'DONE'`, `completed_at` inside the bounds, `deleted_at is null` (archived included; sub-tasks included, shown with their parent's title in the row), each completed occurrence of a repeating task;
  - todos: `is_complete`, `completed_at` inside the bounds, `deleted_at is null`;
  - fields: id, type, title, emoji, project (ref), `completed_at`; ordered by `completed_at`; capped at 200 with "and N more" and a count.
- `countDoneByDay(userId, dates[], prefs)`: counts for the list rows, one query for a page of entries.

The Done list is **worked out when a page opens** and is never stored in `content_json`. "Add to entry" is a client action (§6).

---

## 5. The Done section

- A region under the editor titled **Done on this day** with the count, a fold control (`aria-expanded`), then **Tasks** and **Todos** groups. Each row: a check glyph, the title (opens the task in its side panel, or the todo's edit dialog, in place), the project dot, and the time done ("14:05" in the person's time zone). No completion controls: it is a record, not a list to work from.
- Empty: "Nothing completed this day."
- Past entries show their own day's items, not today's. An item un-done later leaves the list; an item in Trash is not listed.
- **Add to entry** (a ghost button in the section header): inserts the list at the end of the note as a heading "Done" followed by a bullet list of titles (plain text, no links), as one undo step, through `appendDoc`. It writes nothing to the server by itself: the entry saves it like any edit. Adding twice adds two lists (the button says "Add again" after the first use in this visit).
- The section is not part of the editor document, search text or exports of the note. It appears for an unsaved today entry too, so the page is useful before anything is typed.

---

## 6. UI

### Navigation

- `NAV_ITEMS` gains **Journal** (`/journal`, Lucide `BookOpen`). `NAV_GROUPS` is rebuilt from explicit href lists (it is built today with `slice` indexes, which break when items are added). Library reads: Notes, Journal, Canvases, Projects, Templates, Assistant.
- The sidebar row has a chevron (`SidebarSectionToggle`, name `journal`, remembered on the device, shown by default). Unfolded it lists the **latest five entries** by short date (`Tue 13 Oct`) with the first line of text as a tooltip, then **Show all**. The list refreshes through the same note events the Notes tree uses, so a new entry appears without a reload.
- A **+** at the end of the row (visible on hover and on keyboard focus, always visible on touch) opens today's entry. This is the first row-level add control in the sidebar; give it an accessible name "New journal entry" and a tooltip.
- Phone: Journal sits under **More** (`MORE_PREFIXES` gains `/journal`). `isNoteEditorPath` also matches `/journal/{id}` so the entry is full screen with the formatting bar above the keyboard.
- Command menu: **Journal: today's entry** (opens `/journal/today`) and, in Create mode, **New journal entry**.

### `/journal/today` (the add button's target)

A server page: computes today, then
- an entry exists → `redirect` to `/journal/{id}`;
- none exists → renders the entry editor in "new" mode with the title filled in as `journalTitle(today)`, the cursor in the body, and the starting template (if any, slice C) applied. **Nothing is saved until the person edits the body or the title** (as with `/notes/new`); then `createJournalEntry` runs and the address changes to the new entry.
- the entry exists but is archived → opens it with the usual archived banner and Restore.

### `/journal/[id]`

The existing note page, with `journal` set: back to Journal, "Journal" breadcrumb, the date under the title, the Done section under the editor. All note features work (emoji, tags, project, links, backlinks, attachments, Ask / Update with AI, copy, archive, Trash with Undo).

### `/journal`

- Header (shared `PageHeader`): title "Journal", **New entry** (primary; same as the add button).
- **Today row** at the top: today's entry (title, first line, "N done") or, with none, "Start today's entry" and the number completed so far.
- Entries newest first, grouped by month (`October 2026`), as a hairline list (no card): title, first line, "N done", archived marker. Infinite scroll or "Load more" at 30 per page.
- Empty state: "Your journal is empty. Open today's entry to write the first line." with **New entry**.
- Archived entries collapse into a group at the bottom, like Notes.

### Phone, keyboard, accessibility

- The list and Done section work at 360 px; the + is a 44 px target on touch.
- The Done section is a labelled region with a heading and a real list; the fold button has `aria-expanded`; no motion beyond the sidebar chevron rotation (which respects reduced motion).
- Search and Trash show the entry with its date and the label Journal in text, not colour alone.

---

## 7. Rules

- **Owner only.** Every query and action filters by the session user; another person's entry is `NOT_FOUND`. The Done section reads only the person's own items.
- **The server decides the day.** No client-sent date; two devices at the same moment get one entry (the unique index plus `outcome: "exists"`).
- **No new editor.** If a note capability is missing in the journal, fix it in the note component, never by copying it.
- **No content logging.** Entry text and titles are never logged.
- **AI** works as for any note: on request, preview and confirm. The journal adds no AI feature and sends nothing to a model by itself.
- **Works offline like notes do.** Server-backed today; it follows V2 features 04 and 05 when they land (the day computation then moves to the client with the same helpers).
- **Day rules are one function.** Components never do date maths (`CLAUDE.md` §7).

---

## 8. Environment

Nothing new.

---

## 9. Tests

**Unit**
- `journalTitle`: a normal date, the first and last days of a month and year, leap day, single-digit days (no padding), every weekday; independent of the runtime time zone and locale.
- `dayBounds`: default 06:00 start; a custom start; a daylight-saving spring-forward day (23 h) and fall-back day (25 h) in two zones; a zone ahead of UTC and one behind; consecutive days tile with no gap or overlap.
- `getUserToday` at 01:00 and 07:00 with a 06:00 start (the existing function, covered again for the entry).
- The "Add to entry" document builder: heading and bullets, titles with special characters, an empty list adds nothing.

**Integration** (real database)
- Ownership: read, rename, save, archive, delete, restore, permanent delete of another person's entry are `NOT_FOUND`; signed out is `UNAUTHENTICATED`.
- `createJournalEntry`: creates today's; a second call returns `exists` and creates nothing; two concurrent calls create one (unique index); the content is sanitised and the text copy built on the server; no action accepts a date or sets `parent_note_id` or `journal_date` on an entry.
- Query filters: every note query is classified (plain or including entries); `/notes` list, tree, views, the "Move to" list and sub-note targets exclude entries; search, Trash, backlinks, the assistant's tools and pickers include them with the Journal marker.
- Restore with a live entry for the same date → `CONFLICT`; permanent delete frees the date.
- `getDoneOnDay`: tasks and todos completed inside the day are listed; a task completed at 05:59 belongs to the previous day with a 06:00 start; a trashed item is excluded; an archived one is included; an item marked not done leaves; a sub-task and a repeating task's occurrence are listed; the 200 cap reports the true count; another person's items never appear.
- The migration applies on a database with existing notes and leaves them untouched.

**E2E**
1. The sidebar Journal row folds and unfolds, and the choice survives a reload. The + opens today's entry; the title reads `<Weekday>, <D> <Month> <YYYY>` for today.
2. Press the add button twice: the same entry opens, and only one exists in the list.
3. Type in the entry, reload: it is saved; `/notes` does not list it; search finds it labelled Journal.
4. Complete a task and a todo in Tasks; open today's entry: both are under Done on this day. Un-complete the task: it leaves after reload. **Add to entry** puts the list in the note.
5. Open an entry from a previous day (seeded): its Done list shows that day's items only.
6. Rename today's entry; the next day's rollover (clock set) still creates a new entry for the new day.
7. Trash with Undo, restore, archive.
8. Axe on the list, the entry and the Done section, light and dark; 360 px for the list, entry and sidebar-less phone navigation; reduced motion.

Visual baselines: the Journal list (empty and with entries) at 1440 and 360, light and dark, macOS only, with the other baselines.

---

## 10. Definition of done

- [ ] The migration is expand-only (a nullable column, a partial unique index, a check, two partial indexes) and leaves existing notes unchanged
- [ ] A person can open today's entry in one click, write in the full note editor, find it in Journal and search, and no one else can reach it
- [ ] The title is filled in as the date and day; renaming never changes which day the entry belongs to; the day follows the person's time zone and start of day
- [ ] One entry per day, also under concurrency and across devices
- [ ] Entries are left out of the Notes list, tree and views through one shared condition, and a test classifies every note query
- [ ] **Done on this day** is correct for tasks, todos, sub-tasks, repeating tasks, archived and trashed items and day boundaries; it is not stored in the note; Add to entry copies it
- [ ] The sidebar section folds like Projects and Notes; the + and the command menu entries work; the phone path works through More
- [ ] Nothing about writing was rebuilt: the entry page uses the note component
- [ ] Axe passes; 360 px; reduced motion
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/journal-daily-notes_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 11. Out of scope (this feature)

- Mood tracking, streaks, writing prompts, reminders to write.
- A month calendar, jumping to a date, entries for past or future days (the list is the way back).
- Weekly or monthly roll-ups and AI summaries of a day (V2 feature 15 is the weekly review).
- Sub-notes inside an entry; turning an entry into an ordinary note.
- Freezing the Done list when the day ends (Add to entry is the way to keep it).
- Sharing an entry (private by default, feature 04).
- Time tracking; importing from other journal apps.
