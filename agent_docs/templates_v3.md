# Feature: Templates

**Phase:** V3 (feature 03)
**Status:** In progress. Slices A (the table, the Templates page and editor, placeholders, New note from template) and B (the journal template, the starters) are built and tested. Not tried on a real phone, Safari or Firefox.
**Date:** 2026-11-10

## What was built

- **A new table, `templates`** (migration `0023`): name, emoji, title pattern, the checked document, a server-built text copy, a version, `starter_key` and Trash. Their own table, so a template is never in a Notes list, the tree, counts, search or the assistant (`tests/integration/templates.test.ts` checks this). `user_preferences.journal_template_id` names the template that starts journal entries (`on delete set null`).
- **What a template may hold** (`src/lib/templates/schema.ts`, `sanitizeTemplateDoc`): everything a note may except images, files and sub-notes, which are refused with "Templates can't contain images, files or sub-notes." The editor in template mode (`RichTextEditor template`) leaves them out of the slash menu and refuses a pasted image; the server check is the one that counts.
- **Placeholders** (`src/lib/templates/placeholders.ts`, pure): `{{date}}` (13 October 2026), `{{day}}` (Tuesday), `{{time}}` (14:05 in the person's zone) and `{{title}}`, replaced once inside text nodes, as plain text. Spaced braces, unknown names, formulas and a placeholder split by a mark are left as typed. A text node that comes out empty is dropped.
- **Using a template** (`createNoteFromTemplate`, `db/mutations/templates.ts`): makes the note now through `createNote` (title from the pattern, text with placeholders filled, the template's emoji, an optional own project). The template is only read. A template in Trash, someone else's, or stored under older rules with a forbidden block is refused.
- **Pages:** `/templates` (hairline list with a filter, a **Journal** badge in text, a row menu: Use template, Use for journal entries, Duplicate, Delete with Undo; an empty state with the starters) and `/templates/[id]` (name, emoji, title pattern with a hint, the editor, **Insert placeholder**, autosave with version and a conflict banner, **Use template**, a menu). Templates is in the sidebar after Projects and under More on a phone.
- **One picker** (`template-picker.tsx`): a searchable listbox dialog mounted once in the app shell and opened by an event (`openTemplatePicker`), so the command menu (**New note from template…** in Create mode, **Templates** in Search mode), the Notes page (**New note** with a **From template…** menu) and the Templates page share it and dialogs never nest.
- **Starters** (`starters.ts`): Meeting notes, Project brief, Weekly plan, Daily journal. Adding is repeatable and never overwrites an edited copy (`starter_key`, a partial unique index, skipped keys are reported).
- **The journal link** (slice C of the journal): `/journal/today` reads `getJournalTemplate` and fills the placeholders with the **entry's own day**; the text goes into the editor as the starting text and is saved with the first change (`NoteEditor`'s `journal.startDoc`, `useNoteSync`'s `newDoc`). The entry's title stays the date. A missing, trashed or invalid template gives an empty entry.
- **Trash:** `template` joined `TRASH_TYPES` (not `SEARCH_TYPES`). Deleting the journal template clears the choice in the same transaction; restoring does not set it again; restoring a starter's copy while another live copy exists is a `CONFLICT`.

## Why

A person who writes the same kind of note again and again should not rebuild its layout. A separate table and one shared set of rules (`sanitizeTemplateDoc`, `applyPlaceholders`) keep templates out of everything that treats notes as knowledge, and keep a use a plain copy.

## What was deferred

- **Insert a template into an existing note** (open question in the product spec), templates for tasks, projects or canvases, folders or tags, a gallery, AI-written templates.
- **A device draft** for the template editor (a note keeps one for a failed save). The editor retries a failed save and shows "Not saved, retrying", but a closed tab with an unsaved change loses it.
- Template links (`noteLink` in a template) are not counted as backlinks.
- Feature 12's account export does not exist yet, so it does not include templates.
- No design file; built from `DESIGN.md`. Not tried on a real phone, Safari or Firefox.

## Related files

- `src/db/schema/templates.ts`, `drizzle/migrations/0023_templates.sql` (see the migration note below), `src/db/schema/preferences.ts`.
- `src/lib/templates/{types,schema,placeholders,starters}.ts`, `src/lib/validations/templates.ts`, `src/lib/dates/journal.ts` (`journalDateLabel`, `weekdayName`).
- `src/db/mutations/templates.ts`, `src/db/queries/templates.ts`, `src/actions/templates.ts`.
- `src/components/templates/` (`templates-list`, `new-template-button`, `starter-dialog`, `template-editor`, `use-template-save`, `template-picker`, `new-note-menu`), `src/app/(app)/templates/**`.
- Shared files touched: `editor/rich-text-editor-inner.tsx` (the `template` prop), `notes/note-editor.tsx` and `use-note-sync.ts` (`startDoc`, `newDoc`), `journal/today/page.tsx`, Trash (`lib/trash`, `queries/trash`, `mutations/trash`, `actions/trash`, `trash-list`, the Trash page), nav (`nav-items`, `more/page`, `proxy.ts`), `command-menu.tsx`, `app-shell.tsx`, `notes/page.tsx` and `page-header.tsx` (the Notes actions wrap on a phone).
- Tests: `tests/unit/templates-pure.test.ts` (22), `journal-dates.test.ts`; `tests/integration/templates.test.ts` (20); `e2e/templates.spec.ts` (13).

## Hand-off notes

- **Migration `0023`.** The repo's `0022` snapshot did not include the sticky-note columns, so `drizzle-kit generate` wanted to repeat those changes. The generated SQL was cut down to the templates parts by hand; the `0023` snapshot is the generated one and is right. If `generate` asks "created or renamed" about `sticky_canvas_id` again, choose the rename from `board_canvas_id` and drop those statements from the file.
- **A use is a copy; a template is never edited by being used.** Do not let a use write to the template.
- A stored template that no longer passes `sanitizeTemplateDoc` (rules tighten) cannot be used; the editor shows the refusal on the next save. The journal link treats it like a missing template.
- Adding a node type that points at stored content to the editor means adding it to `FORBIDDEN` in `schema.ts`.
- **Migration `0023` is applied to the test database only.** The dev database and Neon still need it (ask first for Neon).
- Related: `journal-daily-notes_v3.md` (slice C is done by this feature), `notes-projects-tags_v1.md`, `nested-notes-links-sidebar-tree_v2.md`, `editor-blocks-and-lists_v2.md`, `dictation-in-editors_v2.md` (the microphone is in the template editor too), `inbox-today-search-trash_v1.md` (Trash).
