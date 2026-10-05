# Feature 01 — Editor Blocks & Lists

## 1. Scope

- A **slash menu** (`/`) to insert blocks, and a **block handle** on every block (turn into, duplicate, delete, move, drag)
- **Tables**, **toggle lists** and **toggle headings**, **callouts**, a **table of contents** block
- **Nested list markers** by depth (`1.` → `a.` → `i.`; dot → circle → square) and indent/outdent controls
- All of it in **notes and task descriptions** (same editor), including the compact variant
- Document rules for the new nodes: schema, validation, limits, plain-text projection
- A small **block registry** so later features (sub-notes, note links, images, files, bookmarks, new linked note) add menu items without editing the core

Reuses from V1: `RichTextEditor` (compact and document variants), `src/lib/editor/{schema,projection,markdown,types}.ts`, `components/editor/{extensions,toolbar}`, `EmojiPicker`, the AI markdown converter.

Source spec sections: product §18 (except §18.6), §19, §13; V1 notes feature doc §4 for autosave.

Not here: clipboard behaviour for the new blocks (feature 02), sub-note and note-link blocks (07), image, file and bookmark blocks (09).

---

## 2. Data model

**No new tables and no migration.** Content stays Tiptap JSON in `notes.content_json` and `tasks.description_json`, and `content_text` / `description_text` stay server-built projections. Existing documents are valid as they are; nothing is migrated.

### New node types (document JSON)

| Node | Content | Attributes | Notes |
|---|---|---|---|
| `callout` | `(paragraph \| bulletList \| orderedList \| taskList)+` | `emoji` (single grapheme, default `💡`), `tone` (`neutral \| info \| success \| warning`, default `neutral`) | No red tone (DESIGN.md: red is rare). No nested callouts or tables inside. |
| `toggle` | `toggleSummary toggleContent` | `id` (short random string, stable) | `id` keys the open/closed state (below). Toggles may nest. |
| `toggleSummary` | inline content | `level` (`0` plain, `1`, `2`, `3` for toggle headings) | A heading-level summary renders with heading styles. |
| `toggleContent` | `block*` | — | Any block, including toggles, lists, tables and callouts. |
| `table` | `tableRow+` | — | |
| `tableRow` | `(tableHeader \| tableCell)+` | — | |
| `tableHeader`, `tableCell` | inline content (one paragraph) | `colspan`/`rowspan` fixed at 1, `colwidth` (number[] or null) | Cells hold inline text only: bold, italic, underline, strike, code, links. |
| `tableOfContents` | none (atom) | — | Rendered from the document's headings; stores nothing. |

Lists keep their V1 nodes. Marker style is **display only** (§6), never stored. `orderedList.attrs.start` stays.

### Limits (enforced in `sanitizeDoc` and in the UI)

| Limit | Value | Behaviour at the limit |
|---|---|---|
| Table size | 10 columns × 100 rows | The add control is disabled with a tooltip; pasted larger tables keep the first 10 × 100 (feature 02) |
| List nesting | 6 levels | Indent is refused with a short message |
| Document depth | `MAX_DEPTH` raised from 20 to 32 | Six nested list levels inside a toggle inside a callout approach the old 20; add a unit test at the edge |
| Document size | 200,000 bytes (unchanged) | Existing "too large" handling |

Open/closed state of toggles is **not in the document**. It is kept per person and device, keyed `toggle:<noteOrTaskId>:<toggle.id>` in `localStorage` (moved into the local database in feature 04). A new toggle starts open. Opening or closing never changes the note, never autosaves and never creates a sync change.

### Plain-text projection (`projection.ts`)

- `callout`: its emoji is dropped, its text is included.
- `toggle`: summary text, then content text, whether open or closed.
- `table`: one line per row, cells separated by a single space (so search finds words, not pipes).
- `tableOfContents`: nothing.
- Existing node projections are unchanged. Add a unit test per new node.

---

## 3. Server contract

No new actions or routes. The existing note and task-description save paths validate and project the new nodes through the updated `sanitizeDoc` and `toPlainText`.

- `richTextSchema` accepts the new nodes and rejects unknown ones as before (`VALIDATION_ERROR`).
- `callout.tone` and `toggleSummary.level` are validated against their enums; `callout.emoji` uses the same single-grapheme check as note emoji.
- Client JSON is passed through the existing `toPlainDoc` JSON round trip before it reaches a Server Action (attrs would otherwise arrive empty).
- **AI output.** The AI Markdown converter (`src/lib/editor/markdown.ts`) now turns a pipe table into a real `table` (first row as header) instead of a bulleted list, within the table limits. The generation prompt's formatting rules (`ALLOWED_FORMATTING` in `src/lib/ai/prompts.ts`) allow tables and no longer say "never use tables"; bump the prompt versions (`GENERATE_CONTENT_V2`). Toggles and callouts are not produced by the AI.

---

## 4. Block registry and slash menu

`src/components/editor/blocks/registry.ts`:

```ts
type BlockItem = {
  id: string;                    // "table", "callout", "toggle", "toggle-h1" ...
  title: string;                 // "Table"
  keywords: string[];            // ["grid", "rows"]
  group: "Basic" | "Lists" | "Layout" | "Insert" | "Links";
  icon: LucideIcon;
  surfaces: ("note" | "task")[]; // where it is offered
  insert(editor: Editor, ctx: EditorContext): void;
  available?(ctx: EditorContext): boolean;
};
registerBlock(item: BlockItem): void;
```

- Core registers: Text, Heading 1–3, Bulleted list, Numbered list, Checklist, Quote, Code, Divider, Table, Toggle, Toggle heading 1–3, Callout, Table of contents.
- Later features register their own (`sub-note`, `new-linked-note`, `image`, `file`, `bookmark`) and the same filter (`surfaces`, `available`) decides what shows. The menu code never changes.
- `EditorContext` carries `surface` (`note` or `task`), the owning id, and whether offline.

**Slash menu** (`SlashMenu`, built on the Tiptap suggestion utility):

- Opens when `/` is typed at the start of an empty line or after a space; never inside a code block or table-cell code. A `/` elsewhere is just a slash.
- Type to filter by title and keywords; ↑ ↓ move; Enter inserts; Esc closes and leaves the typed text; Backspace past the `/` closes it.
- Groups are shown only when the filter is empty. Fuzzy-prefix match, at most 8 results shown, scrolls beyond.
- Inserting replaces the `/query` text. Undo removes the whole block in one step.
- Accessible: `role="listbox"`, options with `aria-selected`, the editor keeps focus (`aria-activedescendant`), announced as "n results".
- Toolbar gains an **Insert** button (opens the same menu) so touch devices need not type `/`.

**Block handle** (`BlockHandle`): a `⋮⋮` control left of the block on hover or keyboard focus (always visible and 44px on touch) with a menu: **Turn into** (text, headings, lists, quote, callout, toggle where valid), **Duplicate**, **Delete**, **Move up**, **Move down**. Dragging the handle reorders blocks. Keyboard: with the handle focused, `Alt+↑` and `Alt+↓` move the block. Drag reorder announces the new position through a live region.

---

## 5. Blocks

### Tables

- **Insert** with `/table` or the Insert button: 3 × 3 with a header row. **Package:** `@tiptap/extension-table` at the pinned Tiptap version (same family as the others; check it supports the pinned React).
- **Keyboard:** Tab and Shift+Tab move between cells; Tab in the last cell adds a row; arrows move across cells at their edges; Enter inside a cell inserts a line break within the cell; ↓ or Tab moves on.
- **Row and column handles** appear at the table's edges on hover or focus: add before and after, delete, move, duplicate. A table menu toggles **header row** and **header column**, and deletes the table.
- **Resize** columns by dragging the column border (stores `colwidth`); double-click resets. Minimum width 80px.
- **Limits** per §2; at the limit the add controls are disabled and a message says why.
- **Phone:** the table scrolls horizontally inside its own container (the note itself does not scroll sideways); handles are 44px.
- **Semantics:** a real `<table>` with `<th scope>` for header cells and a caption-free accessible name from the first header cell; selected cells have a visible outline.
- A table cannot be placed inside a callout, another table or a table cell; it can sit inside a toggle.

### Toggle list and toggle headings

- **Insert** with `/toggle`, `/toggle heading 1…3`, the Insert button, or **Turn into** on an existing line (a heading becomes a toggle heading and back).
- **Use:** a chevron button toggles open or closed (`aria-expanded`, `aria-controls`); Enter at the end of an open summary moves into the first child (creating a paragraph if empty); Enter on an empty last child leaves the toggle; Tab and Shift+Tab move a block into or out of the previous toggle; Backspace at the start of an empty child removes it, and on an empty summary of an empty toggle removes the toggle.
- Closed toggles hide `toggleContent` with CSS only (the content stays in the document, searchable and copyable). Find-in-page and search that match inside a closed toggle open it.
- Open state per §2. Toggle headings use the heading type scale and show in the table of contents.

### Callouts

- `/callout` inserts a callout with the neutral tone and a 💡 emoji; clicking the emoji opens the existing `EmojiPicker`; a small tone menu picks neutral, info, success or warning.
- **Tones** use design-system subtle tokens (`bg-secondary`, `bg-primary-subtle`, success and warning subtle backgrounds). If a success-subtle token is missing, add it through the theme generator (`pnpm theme:generate`) so the contrast guarantee holds. Text is always `foreground`.
- **Accessibility:** `role="note"`; meaning is carried by the emoji and the words, never by the colour alone.
- Enter inside a callout makes a new paragraph; Enter on an empty last paragraph leaves the callout.

### Table of contents

- `/contents` inserts an atom block listing the document's headings (H1–H3, including toggle headings) as links indented by level.
- Clicking a link scrolls to the heading and moves focus to it. The list updates on every document change (debounced 150 ms). With no headings it shows "Add headings to see them here."
- Headings need stable anchors: derived from their position in the heading sequence at render time (`data-heading-index`), not stored.
- At most one table of contents per document is not enforced; each shows the same list.

---

## 6. Nested lists

| Depth | Numbered | Bullet |
|---|---|---|
| 1 | `1.` `2.` `3.` | solid dot |
| 2 | `a.` `b.` `c.` | hollow circle |
| 3 | `i.` `ii.` `iii.` | square |
| 4–6 | pattern repeats from depth 1 | pattern repeats |

- **Display only.** Implemented with CSS `list-style-type` chosen by nesting level (selector chains up to six levels: `ol`, `ol ol`, `ol ol ol`, then repeating). The value is not stored, so indenting, outdenting, pasting and moving always show the right marker, and existing notes update with no migration. After `z`, CSS continues `aa`, `ab`; roman numerals continue as far as the browser allows.
- A nested list restarts at its first marker under each parent. `start` on the first list is honoured.
- **A pure helper** `markerFor(style, depth, ordinal)` in `src/lib/editor/list-markers.ts` returns the same marker as text. It is used by the plain-text and Markdown output in feature 02, so what is copied reads like the screen. Unit test: letters through `z`, `aa`, `ab`, `az`, `ba`; roman numerals 1–39; the depth cycle.
- **Checklists** are not nested (unchanged).
- **Indent / Outdent:** Tab and Shift+Tab in a list item (existing Tiptap behaviour, verify and keep), plus two toolbar buttons (**Indent**, **Outdent**) that act on the current list item or selection, shown wherever a list is active and always on touch toolbars. Enter on an empty nested item outdents it. Indenting beyond depth 6 is refused with "Lists can go six levels deep."

---

## 7. Where each block is available

| Block | Notes | Task descriptions |
|---|---|---|
| Slash menu, handles, tables, toggles, callouts, table of contents, nested list markers | Yes | Yes (compact look: same blocks, smaller type, handles on hover only) |
| Sub-note | Yes (07) | No: the item reads **New linked note** (07) |
| Note link, image, file, bookmark | Yes (07, 09) | Yes |

`surfaces` in the registry encodes this. The compact variant must stay usable in the 420px task panel: tables scroll inside the panel, the slash menu stays within the viewport.

---

## 8. Tests

**Unit**
- `sanitizeDoc`: accepts every new node; rejects bad `tone`, `level`, `emoji`; enforces table limits, list depth, new `MAX_DEPTH`; a callout containing a table or callout is rejected; unknown attributes dropped.
- Projection for every new node, including closed toggles and tables.
- `markerFor`: alphabet and roman edges, depth cycle, `start`.
- Markdown converter: pipe table → `table`, header row set, over-limit table cut; no regression in existing cases (the 26 existing tests keep passing).
- Block registry: surface filtering, `available`, ordering, duplicate ids rejected.
- Slash trigger rules: start of line, after space, not in code.

**Integration**
- Saving a note and a task description containing each new node round trips and builds the right `content_text`; oversized or invalid documents are refused with `VALIDATION_ERROR`.

**E2E**
1. Type `/`, filter to "table", insert; add and remove rows and columns; Tab moves cells; toggle the header row; resize a column; reload and the table is intact.
2. Toggle: insert, open and close, reload, state remembered on the device; the note's version and save status do not change when toggling; text inside a closed toggle is found by search.
3. Callout: insert, change the emoji and tone; Enter and leave behaviour.
4. Table of contents follows heading edits and its links scroll.
5. Nested numbered list three levels deep shows `1.`, `a.`, `i.`; a fourth shows `1.`; bullets show dot, circle, square (assert computed `list-style-type`); indent and outdent buttons change markers; existing notes show the new markers.
6. The same blocks work in a task description in the side panel at 1280px and 360px.
7. Keyboard only: open the slash menu, insert each block, move a block with `Alt+↑`.
8. Axe on a page with every block, light and dark; reduced motion (no animated height on toggles).
9. Existing E2E accessible names do not change (V1 rule).

---

## 9. Definition of done

- [ ] Every block in the product spec §18 (except images, files and bookmarks) can be inserted from the slash menu, the Insert button and (where it applies) Turn into, in notes and in task descriptions
- [ ] Nested lists show `1.`/`a.`/`i.` and dot/circle/square by depth, with no migration, and indent and outdent work on touch
- [ ] Toggle state never changes the saved note; closed content is searchable and copyable
- [ ] Limits are enforced on the client and the server; invalid documents are refused
- [ ] AI-generated tables become real tables
- [ ] The block registry is the only place menu items are added (a later feature adds one without touching core)
- [ ] Usable at 360px, with keyboard only, with a screen reader (table, toggle, callout, listbox semantics), in light and dark
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle`, `theme:check` pass
- [ ] `agent_docs/editor-blocks-and-lists_v2.md` written and indexed

---

## 10. Out of scope (V2)

Column layouts, equations, video and web embeds, synced blocks, inline databases, text and highlight colours, comments, templates (product spec §3 and §18.7); nested checklists; clipboard behaviour (02); sub-notes and note links (07); images, files and bookmarks (09).
