# Feature: Editor blocks and lists

**Phase:** V2 (feature 01)
**Status:** Done
**Date:** 2026-10-06

## What was built

- **Slash menu and Insert button** over one **block registry** (`registerBlock`, `getBlocks(ctx)`, `filterBlocks`). Core blocks: text, headings 1–3, bulleted / numbered / checklist, quote, code, divider, callout, toggle, toggle headings 1–3, table, table of contents. A later feature adds its item with `registerBlock({ surfaces, available })` and touches no menu code.
- **New blocks** (notes and task descriptions share them): `callout` (emoji + tone), `toggle` (= `toggleSummary` + `toggleContent`, optional heading level 1–3), `table` (real header row, resizable columns, one paragraph per cell), `tableOfContents` (no content, built from the headings).
- **Block handle** beside each top-level block (and each block inside a toggle): Turn into, Duplicate, Move up/down, Delete, drag to reorder. `Alt+↑/↓` moves a block with no handle. **Table toolbar** above the table the cursor is in: row and column menus (add, duplicate, move, delete), header row/column, delete table.
- **Nested list markers by depth**, display only, no migration: `1.` `a.` `i.` and dot, circle, square, via a node decoration (`data-list-depth`) and CSS. Indent / Outdent buttons in the toolbar. Existing notes show the new markers.
- **Limits:** table 10 columns × 100 rows, lists 6 levels, `MAX_DEPTH` 32. Enforced in the editor (a `filterTransaction` plugin and a toast) and on the server (`sanitizeDoc`). AI Markdown pipe tables now become real tables (cut to the limits).

## Why

V1 had paragraphs, headings, lists, quotes and code only. The product spec §18–19 asks for the blocks people expect from a notes app, in task descriptions too, without changing how notes are saved: the document is still one JSON value, the text copy is still built on the server.

## What was deferred

- Images, files, bookmark cards (feature 09), sub-notes and note links (07), clipboard behaviour (02), nested checklists, column layouts, colours (out of scope in the feature doc).
- Table drag handles on the row/column edges: replaced by the table toolbar (a floating bar needs fewer pointer targets and works with a keyboard and on touch).
- No visual baselines (`e2e/visual.spec.ts`) for the new blocks. Docker was not run.

## Related files

- `src/lib/editor/schema.ts`: `sanitizeDoc` for every new node (allowed parents, rectangular tables, toggle shape, id and `colwidth` checks, list depth). `limits.ts`: the numbers and messages. `list-markers.ts`: marker labels. `projection.ts`: text for search. `markdown.ts`: pipe tables.
- `src/components/editor/blocks/`: `nodes.tsx` (the node types), `*-view.tsx` (React node views), `registry.ts` + `core-blocks.ts` (the menu items), `slash-menu.tsx`, `block-handle.tsx`, `table-toolbar.tsx`, `table-ops.ts`, `commands.ts` (turn into, duplicate, move, insert), `keys.ts` (Enter / Backspace / Tab in toggles, callouts, tables), `guards.ts` (limits plugin), `toggle-state.ts` (open state), `context.tsx` (surface, owner id, offline).
- `src/components/editor/extensions.ts`: wires it all; `rich-text-editor-inner.tsx` takes `surface` and `ownerId`.
- `src/styles/globals.css` (feature 01 section) and `src/lib/theme/generate.ts` (new `success-subtle` token for the green callout).
- Tests: `tests/unit/{editor-blocks,block-registry}.test.ts`, `tests/integration/editor-blocks.test.ts`, `e2e/editor-blocks.spec.ts`.

## Hand-off notes

- **Structural blocks only live at the top of the document or inside a toggle's body** (schema group `topBlock`). Not in lists, quotes, callouts or cells. Turning a toggle into text unwraps it; toggle → callout is not offered.
- **Toggle open state is per device**, in `localStorage` (`toggle:<ownerId>:<toggleId>`), never in the document, so toggling never saves. Closed content has `hidden="until-found"` (browser find opens it). The `toggleContent` view is plain DOM with `ignoreMutation`: React-set attributes on ProseMirror-managed nodes get wiped.
- **List markers are not stored.** Change the CSS and every note changes. Numbering restarts per `start` attribute as before.
- **Task descriptions get every block**; the registry's `surfaces` decides what the menu offers there (nothing is notes-only yet).
- **Lint:** the React compiler rules forbid reading refs in render and mutating hook arguments. The editor is created once, so extensions read the latest context through `createContextHolder` rather than a ref.
- **Menus taller than the screen:** the block-handle menu has a max height and scrolls (14 Turn-into entries).
- **Design/spec notes:** table edge handles became the table toolbar (above); `success-subtle` is a generated token (`pnpm theme:generate`), not a hand-written hex.
- Related: `notes-projects-tags_v1.md` (editor, autosave), `tasks-and-todos_v1.md` (task description), `ai-writing-and-planning_v1.md` (AI tables now real tables; `ALLOWED_FORMATTING` allows pipe tables, `GENERATE_CONTENT_V2`).
