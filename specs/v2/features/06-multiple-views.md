# Feature 06 — Multiple Views

## 1. Scope

- **Saved views** with tabs for three collections: **Tasks**, **Todos**, **Notes** (and the same views, limited to one project, on project pages)
- View types: **List**, **Table**, **Board** (Kanban), **Calendar** (tasks and todos), **Gallery** (notes). **Tree** (notes) is a slot filled by feature 07
- Per-view **filters, sorts, grouping, visible properties** and how items open
- **Table** with inline cell editing and bulk actions; **Board** with drag between columns; **Calendar** with drag to reschedule
- A pure **view engine** (filter, sort, group) that runs on the local database, so views are instant and work offline
- Defaults for new and existing accounts; legacy URLs keep working

Built-in properties only (no user-defined fields, formulas or relations). **Timeline** and chart views are not in V2.

Reuses: V1 task, todo and note components and pickers (`StatusPicker`, `PriorityPicker`, `DatePicker`, `ProjectPicker`, `TagPicker`, `DueChip`), `src/lib/tasks/*` (status, recurrence, ordering, grouping), `src/lib/today/buckets.ts` (due buckets), `src/lib/dates/*`, feature 04's repositories and commands, feature 05's operations (`view.*`).

Packages: a drag-and-drop library (ADR 0008; V1 has only keyboard reordering, so cross-container drag is new). Candidate: `@dnd-kit/core` + `@dnd-kit/sortable` (supports keyboard and touch sensors). No virtualization library: paging per spec.

Source spec sections: product §17, §13, §2.1 row 14; technical §3 (local data); V1 tasks and notes feature docs for list behaviour.

---

## 2. Data model

### `collection_views`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | client-generated |
| `user_id` | uuid FK → user, cascade | |
| `collection` | enum `TASKS, TODOS, NOTES` | |
| `name` | text NOT NULL | 1–60 chars |
| `emoji` | text NULL | optional icon (single grapheme) |
| `type` | enum `LIST, TABLE, BOARD, CALENDAR, GALLERY, TREE` | `CALENDAR` only for tasks and todos; `GALLERY` and `TREE` only for notes |
| `position` | double precision NOT NULL | tab order (fractional keys) |
| `config` | jsonb NOT NULL | validated by `viewConfigSchema` (§3) |
| `version`, `last_modified_by_device_id`, `created_at`, `updated_at`, `deleted_at` | | sync columns (05) |

Index `(user_id, collection, deleted_at, position)`. An app rule (and a server check) keeps **at least one** non-deleted view per collection.

**Backfill migration:** one `LIST` view per user per collection, named "All tasks", "All todos" and "All notes". The old `?view=grid` setting is not migrated; a Gallery view is created on demand (§5). New users get the same three views in the sign-up transaction. A client that finds none creates the default locally.

### `notes.sort_order`

Notes gain `sort_order double precision NOT NULL` (backfilled from `updated_at` descending so the current order is preserved), index `(user_id, sort_order)`. It gives notes boards and the sidebar tree (07) a manual order. Tasks and todos already have `sort_order`.

### Local (Dexie)

`views` store mirrors the table; `uiState` keeps `lastView:<collection>` and per-view UI state not worth syncing (scroll, collapsed board columns).

---

## 3. View configuration

```ts
type ViewConfig = {
  filters: ViewFilter[];            // combined with AND
  sorts: { property: string; dir: "asc" | "desc" }[];   // [] = manual order
  groupBy: string | null;           // board columns / table groups / list groups
  hideEmptyGroups: boolean;
  columnOrder?: string[];           // table columns / card fields in order
  visibleProperties: string[];
  columnWidths?: Record<string, number>;
  boardColumnOrder?: Record<string, string[]>;   // manual order for project/tag grouping
  collapsedGroups?: string[];       // ids of collapsed board columns (kept per view)
  cardSize?: "small" | "medium" | "large";       // gallery
  calendar?: { mode: "month" | "week"; showCompleted: boolean };
  openIn: "panel" | "page";
};
type ViewFilter = { property: string; op: FilterOp; value?: unknown };
type FilterOp = "is" | "isNot" | "isAnyOf" | "isNoneOf" | "isEmpty" | "isNotEmpty" |
                "contains" | "before" | "after" | "between" | "inBucket";
```

`viewConfigSchema` (Zod, `src/lib/validations/views.ts`) validates the config per collection: unknown properties, ops that do not fit the property type, more than 12 filters or 4 sorts are rejected. Properties per collection:

| Collection | Properties |
|---|---|
| Tasks | title, status, priority, dueDate (and time), startDate, project, tags, subtasks (progress), linkedNotes, created, updated |
| Todos | title, done, dueDate, project, created |
| Notes | title, project, tags, parentNote (07), linkedTasks, created, updated |

---

## 4. View engine

`src/lib/views/` (pure, no I/O, shared by the local app and server renders):

```ts
runView<T>(collection, items: T[], config, ctx: { prefs: DayPrefs; now: Date }): ViewResult<T>
// -> { groups: { key, label, items }[] , total }
```

- `filter.ts`: evaluates filters; date filters use the person's day (`src/lib/dates`), including the **due buckets** Overdue, Today, This week, Later, No date (from `bucketToday`/`grouping.ts`; one definition).
- `sort.ts`: stable multi-sort; `[]` means manual `sort_order`.
- `group.ts`: grouping by status, priority, project, due bucket, tag (a task appears in each of its tags' groups and in "No tag" when it has none), done, parent note; a **No value** group for empty values; stable group order (fixed for status and priority, `boardColumnOrder` or name for project and tag).
- Properties are accessors in one registry (`properties.ts`) so filters, sorts, groups, table columns and card fields share one definition per property.
- Output is paged: each group exposes the first 50 items and a `loadMore` cursor.

All screens call the engine on **local data** (feature 04's live queries). Server-rendered first paint of the default List view still uses the same engine on server data.

---

## 5. Views behaviour

### Tabs and settings

- `ViewTabs` above the items: one tab per view, a **+ View** button (type picker and the ready-made starts "Board by status", "Table", "Calendar"), tab menu (rename, icon, duplicate, delete, move). Deleting the last view is refused ("A collection needs at least one view").
- **View settings** (one menu per view): filters (builder), sorts, group by, hide empty groups, visible properties, how items open. Today's quick filter chips (status, due, project, tag) stay and **edit the current view's filters**.
- Changes save to the view immediately (no save step) through `view.update` operations (05), coalesced.
- The last view used per collection is remembered on the device; `?view=<viewId>` selects one. **Legacy URLs:** `/tasks?view=todos` → the Todos collection's last view; `/notes?view=grid` → the first `GALLERY` view (create one on the fly if missing); unknown values fall back to the first view.
- A new view starts from the chosen type and a copy of the current filters.

### List

Today's grouped list with quick actions and the keyboard reorder, rendered through the engine. It is the default view and cannot be deleted while it is the only one.

### Table

- Columns are the visible properties; the **title column is frozen** while scrolling sideways. Click a heading to sort (arrow shows direction; shift-click adds a sort). Columns can be hidden, reordered (drag or menu) and resized; widths persist in the view.
- **Cell editing:** click a cell to edit in place using the existing pickers (status, priority, due date and time, project, tags, done); title edits inline. Enter saves, Esc cancels, Tab moves to the next cell. Each change is an ordinary command with Undo.
- **Selection and bulk actions:** row checkboxes, shift-click ranges, select all in view. A bulk bar offers: set status, set priority, set project, add or remove a tag, set due date, complete, archive, move to Trash. One **Undo** reverses a whole bulk action (operations share a `groupId`; the toast carries it).
- Footer: total count (and per-group counts when grouped). Rows load 50 at a time ("Show more").
- Opening a title follows the view's `openIn` (task and todo panel, note full page).
- Semantics: a real table with `role="grid"` only when cells are editable; header cells with `aria-sort`.

### Board

- Columns are the groups. Defaults: tasks by **status** (INBOX, PLANNED, IN_PROGRESS, WAITING, DONE, CANCELLED; Done and Cancelled collapsed by default), todos by done/not done, notes by project. Group by can switch to priority, project, due bucket, tag (and, for notes, project or tag only).
- **Cards** show emoji and title and the visible properties (due chip with the same overdue styling, priority glyph, tags, subtask progress, project token). Card size is fixed; text wraps to two lines.
- **No value** column for items without the property; columns can be collapsed; empty columns hidden by the setting. Column order is fixed for status, priority and due bucket; for project and tag it follows `boardColumnOrder` (drag column headers).
- **Drag a card** to another column (pointer, touch long-press, or keyboard: focus the card, Space to lift, arrows to move between columns and rows, Space to drop, Esc to cancel; a live region announces "Moved to In progress, position 2"). The drop runs `moveCard`:

| Group by | Drop on column | Effect |
|---|---|---|
| status | a status | `task.update { status }` through `src/lib/tasks/status.ts`; **Done** runs the completion logic including the next occurrence of a repeating task |
| priority | a priority | set priority |
| project | a project or No project | `assignToProject` (subtasks follow, V1 rule) |
| due bucket | Today, This week, Later, No date | set a due date: Today = today; This week = keep the weekday if in the future else the next day; Later = start of next week; No date = clear. **Overdue is not a valid drop** (a toast says why) |
| tag | a tag | move one tag: remove the source tag, add the target (the card keeps its other tags) |
| done (todos) | Done / Not done | toggle |
| project / tag (notes) | a column | assign project / move tag |

  A drop that cannot apply is refused with a toast; nothing changes. Every successful drop shows a toast that names the change and offers **Undo** (the inverse command).
- **Order inside a column** is manual (`sort_order`), saved on drop between neighbours with a fractional key. A view with a sort set orders by the sort and disables manual reorder within columns.
- Each column has **+ New** that creates an item already carrying that column's value.
- Mobile: one column at a time, swipe between columns, long-press to drag, "Move to…" menu on every card.

### Calendar (tasks and todos)

- **Month** and **week** layouts; week starts per the person's setting; Today marked. Items sit on their due date; tasks with start and due dates span the days between.
- **Drag an item to another day** to reschedule (keyboard: card menu "Move to date…" with a date picker). An **Undated** list at the side lists items without a due date; drag one onto a day to schedule it.
- Completed items hidden unless `showCompleted`.
- **Overlay slot:** feature 12 registers a provider that draws Google Calendar events as quiet read-only blocks; until then no overlay.
- Phone: under 640px the calendar defaults to a **week agenda** (a day-by-day list), with drag replaced by the card menu.

### Gallery (notes)

Today's card grid as a named view: emoji, title, snippet, tags, updated time; card size small, medium, large. A cover image appears once images exist (09).

### Tree (notes)

Provided by feature 07 (the type is registered here and disabled in the "+ View" menu until 07 ships).

### Project pages

`/projects/[id]` offers the same tabs for tasks, todos and notes, each view **additionally limited to that project** (an implicit, non-removable filter). Views themselves are shared across the app; they are not duplicated per project.

---

## 6. Server contract

Views live in the sync model. Write paths:

- Operations (05): `view.create`, `view.update`, `view.reorder`, `view.delete`, `view.restore`.
- Server Actions for online-only surfaces (Settings): `createView`, `updateView`, `deleteView`, `restoreView` call the same mutation functions. `viewConfigSchema` validates both.
- Queries: views are read from the local database; the server renders the first view for first paint using `getViews(userId, collection)`.

Item mutations triggered by Table and Board are the **existing commands/operations** (`task.update`, `assignToProject`, `setTaskTags`, bulk = many operations with one `groupId`). No bespoke endpoints.

Rules: a user can only read or write their own views; `project` and `tag` filters may only reference the user's own ids (a filter on a deleted project simply matches nothing); an invalid saved config falls back to the default for its type and the person sees "This view's settings were reset" once.

---

## 7. Accessibility, performance, mobile

- Every drag has the keyboard and touch alternative above and announces changes; tables and boards use correct roles and labels; colour is never the only signal for a column.
- 44px touch targets; boards and tables usable at 360px as described.
- First paint within the V1 budget: the server renders the default view; heavy views hydrate from local data. Pages of 50 per group or table; `Show more` loads the next page. Filtering and sorting 5,000 local items stays under 50 ms (benchmark test with a generated dataset).
- Reduced motion: no card flight animation; instant reorder with the live-region announcement.

---

## 8. Tests

**Unit** (`src/lib/views/*`)
- Filters per property type and op; due buckets across day boundaries and start-of-day rollover; multi-sort stability; manual order.
- Group by every property including tags (multi-membership, "No tag"), No value, hide empty, stable order.
- `moveCard` mapping table: each group-by drop produces the right command, refuses Overdue, tag move keeps other tags, Done runs recurrence.
- `viewConfigSchema`: valid and invalid configs per collection; limits.
- Legacy URL resolution; default view creation.
- Fractional ordering between neighbours.

**Integration**
- View CRUD through operations: ownership (another person's view is `NOT_FOUND`), at-least-one-view rule, config validation, tombstone sync.
- Backfill creates one List view per collection per user.
- Bulk operations with a `groupId` apply atomically per operation and are individually idempotent.

**E2E**
1. Add a Board view to Tasks (by status); drag a card to In progress and to Done (a repeating task creates its next occurrence); Undo each.
2. Add a Table view; sort by due date; edit a status in a cell; select rows and set a project in one action; Undo.
3. Calendar: drag a task to another day; schedule an undated todo; month and week; Google overlay absent.
4. Notes as Board by project (drag changes the project), as Gallery.
5. Each view keeps its own filters, sorts and columns; the last view reopens; legacy `?view=grid` works.
6. Offline: every view works and edits sync after reconnect.
7. Project page shows the same views limited to the project.
8. Keyboard-only drag on the Board; phone layout at 360px; axe light and dark; reduced motion.
9. 2,000 generated tasks: table and board stay responsive (paging).

---

## 9. Definition of done

- [ ] Board, Table, List, Calendar (tasks and todos) and Gallery (notes) exist as saved views with their own filters, sorts, grouping and visible properties
- [ ] Dragging a card changes the item with Undo, using the same logic as everywhere else; impossible drops are refused clearly
- [ ] Table edits cells in place and supports bulk actions with one Undo
- [ ] Views work offline, instantly, and sync as ordinary data
- [ ] Project pages offer the same views limited to the project
- [ ] Legacy URLs and existing users' lists keep working (backfill)
- [ ] Every drag has a keyboard and touch alternative; usable at 360px
- [ ] ADR 0008 (drag and drop) written before building; no new dependency beyond it
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/multiple-views_v2.md` written and indexed

---

## 10. Out of scope (V2)

Timeline and chart views; user-defined properties, formulas, relations and rollups; shared or public views; OR filter groups and sub-grouping; "save this search as a view"; per-project saved views; calendar write-back to Google (12); inline databases inside notes.
