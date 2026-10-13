# Feature 03 — Templates (V3)

> **Build priority: third V3 feature** (owner, 2026-10-13). Behaviour is in V3 product spec §6. It can start once the canvas (01) is done, and it completes feature 02's slice C (the journal's starting template). Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- A **Templates** sidebar tab and `/templates` page: create, edit, duplicate, delete and restore templates.
- A template editor page (`/templates/[id]`) in the same rich-text editor as notes.
- **New note from template**: from the Notes page, the Templates page and the command menu.
- A **journal template**: one template can start every new journal entry (feature 02).
- **Placeholders** (`{{date}}`, `{{day}}`, `{{time}}`, `{{title}}`) filled in once, when a note is made.
- **Starter templates** the person can add: Meeting notes, Project brief, Weekly plan, Daily journal.

Reuses: `RichTextEditor` and `useAutosave`, `sanitizeDoc` and the server-built text projection, the note-creation path (`createNote`), V1 Trash semantics, `src/lib/dates/` for the placeholder values, the sidebar and More-page pattern, the `ConfirmDialog` and `EmptyState` components.

Packages: none.

Source spec sections: V3 product §6, `../Agent.md` §9 (migrations), V1 Agent rules (server and client boundaries).

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Table, actions, Templates page and editor, placeholders, New note from template (Notes page, command menu) | A person can keep and use templates |
| **B** | Journal template link, starter templates | Journal entries start from a layout |

---

## 2. Data model

Templates are **their own table**, not notes with a flag. They must never appear in Notes lists, the tree, views, counts, global search or the assistant, and a table makes that true by construction instead of by a filter that every query must remember.

### `templates` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUID v7 |
| `user_id` | uuid FK → user, cascade | |
| `name` | text NOT NULL | 1 to 120 chars (check) |
| `emoji` | text NULL | one grapheme, same rule as notes |
| `title_pattern` | text NOT NULL default '' | ≤ 300 chars (check); may contain placeholders |
| `content_json` | jsonb NOT NULL | the checked document (§3) |
| `content_text` | text NOT NULL default '' | plain-text copy built on the server, used for the list preview |
| `version` | integer NOT NULL default 1 | bumped on every accepted save; a stale save is refused |
| `starter_key` | text NULL | set on copies of starters (`meeting-notes`, `project-brief`, `weekly-plan`, `daily-journal`) so adding them twice does not duplicate |
| `created_at`, `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | Trash |

Indexes: `(user_id, deleted_at)`, `(user_id, updated_at DESC)`, unique `(user_id, starter_key) where starter_key is not null and deleted_at is null`.

Limit: **50 live templates** per person (`TEMPLATE_LIMIT`); over it returns `QUOTA_EXCEEDED`.

### `user_preferences` (changed)

`journal_template_id uuid NULL` references `templates(id)` on delete set null. One migration, expand-only.

---

## 3. What a template may contain

The same blocks as a note, **except** blocks that point at stored content:

- not allowed: `image`, `file` (a copy would share one stored file, and deleting the file with one note would break the other), `subNote` (a copy would create sub-notes by surprise);
- allowed: text, headings, lists, task lists, tables, toggles, callouts, table of contents, `noteLink` (a link to a note), `bookmark` (a URL card, no file), code, quotes, rules.

`sanitizeTemplateDoc(doc)` in `src/lib/templates/schema.ts` runs `sanitizeDoc` and then **rejects** (not silently removes) the three forbidden node types with a plain message ("Templates can't contain images, files or sub-notes."). The editor, in template mode, also hides those slash-menu items and refuses paste and drop of files and images, so the person is told before saving. The server check is the one that counts.

---

## 4. Placeholders

`src/lib/templates/placeholders.ts`, pure:

`applyPlaceholders(doc, ctx): TiptapDoc` and `applyToTitle(pattern, ctx): string`, with `ctx = { day: string /* YYYY-MM-DD */, now: Date, timezone: string, title: string }`.

| Placeholder | Value |
|---|---|
| `{{date}}` | `13 October 2026` (the day, as the journal title helper formats the date part) |
| `{{day}}` | `Tuesday` |
| `{{time}}` | `14:05`, 24-hour, in the person's time zone, from `now` |
| `{{title}}` | the new note's title (empty if none) |

- **Which day:** for a note it is today (the person's day rules); for a journal entry it is the entry's own day.
- Replaced **inside text nodes only**, once, when the note is made. A placeholder split across two text nodes by a mark (half bold) is **not** matched, which is why the template editor has an **Insert placeholder** menu that inserts each one as a single text node. Anything else in braces, and any unknown name, is left exactly as typed.
- Replacement text goes in as plain text with the original node's marks. It cannot create nodes, links or HTML.
- No formats, offsets or logic (`{{date+1}}` is not supported).
- The function never throws: a malformed document returns unchanged.

---

## 5. Server contract

Actions in `src/actions/templates.ts` (each starts with `requireUser()`, Zod input, `runAction`):

| Action | Purpose |
|---|---|
| `createTemplate({ name?, emoji?, titlePattern?, contentJson? })` | New template (name defaults to "Untitled template"); limit check |
| `saveTemplate({ id, version, contentJson?, name?, titlePattern? })` | Returns `{ outcome: "saved" \| "conflict", version }` as data, like notes; runs `sanitizeTemplateDoc`; rebuilds the text copy |
| `updateTemplateMeta({ id, name?, emoji? })` | Name and emoji |
| `duplicateTemplate({ id })` | Copy named "<name> copy" (limit check; clears `starter_key`) |
| `deleteTemplate`, `restoreTemplate`, `permanentlyDeleteTemplate` | Trash with Undo, restore, delete for good. Deleting the journal template clears the preference |
| `createNoteFromTemplate({ templateId, projectId? })` | Creates the note **now** (an explicit choice, unlike `/notes/new`): content and title from the template with placeholders applied, optional project. Returns `{ id, version }`. A template in Trash or another person's is `NOT_FOUND` |
| `setJournalTemplate({ templateId \| null })` | Sets or clears the preference; the template must be the person's own and live |
| `addStarterTemplates({ keys })` | Adds copies of the chosen starters; skips keys the person already has (live) and reports `{ added, skipped }`. Never overwrites |

Queries: `listTemplates`, `getTemplate`, `getJournalTemplate`. A "use" never edits the template. Feature 02's `/journal/today` calls `getJournalTemplate` and `applyPlaceholders` with the entry's day.

Starters live in code (`src/lib/templates/starters.ts`) as typed documents, each passing `sanitizeTemplateDoc` in a test:

- **Meeting notes:** title pattern `Meeting: {{date}}`; sections Attendees, Notes, Decisions, Action items (task list).
- **Project brief:** Goal, Scope, Risks, Next steps.
- **Weekly plan:** title pattern `Week of {{date}}`; Top three, Blocked by, Wins.
- **Daily journal:** Morning intention, Notes, End of day.

Trash and search: `template` joins `TRASH_TYPES` and `trashHref`. It does **not** join `SEARCH_TYPES`: templates are found only by the filter box on the Templates page.

---

## 6. UI

### Navigation

- `NAV_ITEMS` gains **Templates** (`/templates`, Lucide `LayoutTemplate`) in the Library group after Projects (Notes, Journal, Canvases, Projects, Templates, Assistant). No fold control: it has no children. Under **More** on a phone (`MORE_PREFIXES` gains `/templates`).
- Command menu: **New note from template…** (Create mode; opens a searchable list of templates, then creates and opens the note) and **Templates** (navigate).
- Notes page: the add control becomes a split control, **New note** and a menu entry **From template…**, opening the same searchable list. With no templates it explains and links to Templates.

### Templates page (`/templates`)

Shared `PageHeader`: title, count, **New template** (primary). A hairline list (no cards): emoji, name, one-line preview from `content_text`, a **Journal** text badge on the chosen one, updated time. A filter box. Row menu: Use template, Use for journal entries, Duplicate, Delete. Empty state: "Templates are starting points for your notes." with **Add starter templates** and **New template**; the starter button opens a small dialog listing the four with checkboxes (already added ones are labelled and disabled).

### Template page (`/templates/[id]`)

A narrow page like a note: name (editable), emoji, **Title pattern** field with a hint ("Used as the note's title, for example Meeting: {{date}}"), the editor in template mode, an **Insert placeholder** menu (the four values, each inserted as one text node), and the save state text. Actions: **Use template** (primary; creates a note and opens it), `…` menu: Use for journal entries / Stop using for journal entries, Duplicate, Delete. Autosave and conflict banner as notes. Deleted: Undo toast.

### Phone and accessibility

- List and editor work at 360 px; the editor takes the screen like a note.
- The "From template…" list is a keyboard-operable listbox (the shared picker list), 44 px rows on touch.
- The Journal badge is text, not colour; placeholders in the editor are plain text and are announced as typed.

---

## 7. Rules

- **Owner only.** Every query and action filters by the session user. Another person's template id is `NOT_FOUND`.
- **A use is a copy.** Editing or deleting a template never changes existing notes or entries.
- **Placeholders are plain text replacement.** They cannot run anything.
- **Not knowledge.** Templates do not appear in search, the assistant, counts, or AI prompts. There is no AI template generation here.
- **No content logging.** Template text is never logged.
- **Same editor.** Template mode is a prop on `RichTextEditor`, not a second editor.
- **Journal link degrades quietly.** If the journal template is missing or invalid, a new entry starts empty.

---

## 8. Environment

Nothing new. `TEMPLATE_LIMIT` (50) is a constant.

---

## 9. Tests

**Unit**
- `sanitizeTemplateDoc`: every allowed node kept; `image`, `file`, `subNote` rejected with the message; oversized documents rejected like notes.
- `applyPlaceholders`: each placeholder; two of the same; adjacent to marks; a placeholder split across nodes is left; unknown names untouched; `{{ date }}` with spaces untouched; replacement text containing braces or HTML stays plain text; the entry's day versus today; midnight and start-of-day edges; a malformed document returned unchanged; `{{title}}` empty.
- `applyToTitle`: patterns with several placeholders; over-length result cut to 300.
- Starters: each is valid, within block limits, and contains no forbidden node.

**Integration** (real database)
- Ownership matrix for every action and for `createNoteFromTemplate` with another person's template: `NOT_FOUND`; signed out `UNAUTHENTICATED`.
- `saveTemplate`: saved then stale gives `conflict`; the text copy is rebuilt on the server and a client copy is ignored; forbidden nodes rejected.
- `createNoteFromTemplate`: content and title as expected, project assigned only if the person's own; the template is unchanged; a trashed template is `NOT_FOUND`.
- Limit: the 51st template is `QUOTA_EXCEEDED`; duplicating at the limit too.
- Trash, restore, permanent delete; deleting the journal template clears the preference; restoring does not set it again.
- `addStarterTemplates` twice adds nothing the second time and never changes an edited copy.
- Templates are absent from search, notes lists, counts and the assistant's tool results.
- Journal link: with a template set, feature 02's new entry carries its content with the entry's day; without one it is empty.

**E2E**
1. Add starter templates; open one; edit; reload: unchanged. Another person cannot open its address.
2. Notes page → From template…: the new note has the content, today's date filled in and the pattern as its title; editing the template afterwards does not change that note.
3. Insert placeholder inserts one value; an image or file cannot be pasted into the template.
4. Use for journal entries: the next new journal entry starts from it with its own day's date; the Journal badge shows.
5. Delete with Undo, restore from Trash.
6. The command menu's New note from template works from any page.
7. Axe on the list, the editor and the picker, light and dark; 360 px.

---

## 10. Definition of done

- [ ] The migration is expand-only (a new table and one nullable column)
- [ ] A person can create, edit, duplicate, delete and restore templates; no one else can reach them
- [ ] Templates cannot contain images, files or sub-notes, and the server enforces it
- [ ] New note from template works from the Notes page, the Templates page and the command menu; placeholders are filled once and as plain text; the template is unchanged
- [ ] The journal template starts new entries (feature 02 slice C), with the entry's own day
- [ ] Starters can be added once each and never overwrite edits
- [ ] Templates never appear in search, lists, counts or AI
- [ ] Axe passes; 360 px; reduced motion
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/templates_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 11. Out of scope (this feature)

- Inserting a template into a note that already exists (open question in the product spec).
- Templates for tasks, projects or canvases.
- Date maths, formats, loops or any logic in placeholders.
- AI-written templates; sharing, importing or exporting templates by themselves (they are included in the account export, feature 12).
- Folders or tags for templates; a template gallery.
