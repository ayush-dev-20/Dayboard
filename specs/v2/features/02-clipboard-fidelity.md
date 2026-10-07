# Feature 02 — Clipboard Fidelity

## 1. Scope

- **Copy out:** what is copied from the editor pastes into Slack, Notion, Google Docs, Gmail, Apple Notes, Microsoft Word and Markdown editors with the same structure, as far as each tool can hold it
- **Paste in:** content pasted from those tools, from web pages and from VS Code keeps its structure (lists stay lists, headings stay headings, code stays code) inside the editor's own formats
- **Dayboard to Dayboard** is lossless
- **Copy note** and **Copy as Markdown** actions
- Plain paste (`Cmd/Ctrl+Shift+V`), paste inside lists, code blocks and single-line fields, one undo step per paste
- A **paste rule registry** so later features (note links, images, bookmarks) hook into paste without editing the core
- Real-clipboard **fixtures** and a compatibility matrix as the acceptance test

Applies wherever the editor appears: notes and task descriptions.

Reuses: `RichTextEditor`, `sanitizeDoc`, `src/lib/editor/markdown.ts` (`markdownToDoc`, `convertMarkdown`), `toPlainText`, feature 01's `markerFor` and new nodes.

Source spec sections: product §15 (all), §18.2 and §19.3 for tables and list markers.

---

## 2. Data model

None. No tables, no migration. A new **clipboard flavour** is defined:

| MIME type | Content | Written on | Read on |
|---|---|---|---|
| `text/html` | Clean semantic HTML (§4) | copy, cut | paste into other tools; paste into Dayboard when no internal flavour |
| `text/plain` | Markdown with on-screen list markers (§4) | copy, cut | tools that read text only; Dayboard's text heuristics |
| `application/x-dayboard-slice+json` | `{ v: 1, doc: <TiptapDoc fragment>, openStart, openEnd }` | copy, cut | Dayboard paste (lossless) |

The internal flavour carries a version `v`; an unknown version is ignored and the HTML flavour is used.

---

## 3. Module layout

```text
src/lib/editor/clipboard/
  serialize-html.ts      doc fragment -> clean HTML string
  serialize-markdown.ts  doc fragment -> Markdown text (uses markerFor)
  parse-html.ts          HTML string -> TiptapDoc (inert DOM, producer detection)
  producers/             google-docs.ts, word.ts, notion.ts, slack.ts, apple.ts,
                         gmail.ts, github.ts, vscode.ts, generic.ts
  parse-text.ts          plain text -> TiptapDoc (list heuristics, Markdown detection)
  rules.ts               paste rule registry
  index.ts               ProseMirror plugin: clipboardSerializer, clipboardTextSerializer,
                         handlePaste, handleDOMEvents.copy/cut
src/components/editor/clipboard-extension.ts   Tiptap extension wrapping the plugin
```

Everything under `src/lib/editor/clipboard/` is pure (string in, document out) and runs in the browser and in Vitest. The Tiptap extension is the only DOM-aware part.

---

## 4. Copy out

**HTML flavour** (`serialize-html.ts`). Output only these elements: `h1`–`h3`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre > code`, `hr`, `table > tr > th/td`, `details > summary`, `strong`, `em`, `u`, `s`, `code`, `a[href]`, `br`. Rules:

- No classes, ids, `style`, `data-*`, or editor wrappers (strip `data-pm-slice`).
- Tight lists: **no `<p>` inside `<li>`** (a list item's single paragraph is unwrapped), nested lists nested inside the `li`.
- Ordered lists carry their marker type per level: `type="1"`, `type="a"`, `type="i"` by depth (feature 01 §6), plus `start` when set.
- Checklists: `<ul>` with `<li><input type="checkbox" disabled checked?> text</li>` (GitHub style). A fixture for each target decides whether checkboxes survive; where they do not, the degrade rule below applies.
- Toggles: `<details open><summary>summary</summary>…content…</details>` (always expanded). Toggle headings: summary containing the heading as `<strong>`-wrapped text at heading level via `h1`–`h3` inside `summary`.
- Callouts: `<blockquote>` whose first paragraph starts with the emoji and a space.
- Tables: real `<table>`, header cells as `<th>`.
- Note links and sub-note blocks (feature 07): `<a href="{origin}/notes/{id}">{title}</a>`; images (feature 09): not included in HTML copy (see §8).
- Links: only `http`, `https`, `mailto` `href`s.

**Plain-text flavour** (`serialize-markdown.ts`): headings `#`, bullets `-`, checklists `- [ ]`/`- [x]`, quotes `>`, fenced code with language, `---`, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`, tables as pipe tables with a separator row. **Numbered items use the markers shown on screen** (`1.`, `a.`, `i.`) with indentation, so the text reads like the editor and Dayboard can read it back. Toggle: summary line, then the content indented; callout: `> 💡 text`.

**Which flavours, when.** On copy and cut the plugin writes all three. A selection inside one text block copies as inline HTML (no wrapping block) so pasting a word into a sentence does not add a paragraph break.

**Degrade rules** (documented here and tested by the matrix): a tool without headings gets a bold line; without underline, none; without checklists, `☐ `/`☑ ` prefixed lines; without toggles, a bold summary then the content; without tables, rows as lines with ` | `. The HTML we write is already the plain form; the target chooses what to keep. We never write markup that shows as raw text in a tool that ignores it.

**Cut** removes the selection and writes the same flavours; one undo step restores.

**Copy note** and **Copy as Markdown** (note overflow menu, notes only): write the whole document through the same serialisers via `navigator.clipboard.write` with a `ClipboardItem` carrying the three flavours; fall back to `writeText` if `ClipboardItem` is unavailable. Toast "Copied". Both appear in the command menu for the open note.

---

## 5. Paste in

Order of precedence in `handlePaste(view, event)`:

1. **Shift pressed** (`view.input.shiftKey`, i.e. `Cmd/Ctrl+Shift+V`): insert `text/plain` only, as plain paragraphs, no detection.
2. **Paste rules** from the registry (later features): note address → note link (07); image files → upload (09); bare URL → bookmark choice (09). A rule returns `handled` or declines. Core registers none that change behaviour in this feature except the URL-over-selection rule below.
3. **Internal flavour** present and `v` known → insert the fragment losslessly.
4. **HTML flavour** → `parse-html` (below), then insert.
5. **Plain text** → `parse-text`, then insert.

### From HTML (`parse-html.ts`)

- Parse with `DOMParser` into an **inert** document (no scripts run, no resources load), never `innerHTML` on a live element. Walk the tree and build a document; run the result through `sanitizeDoc`.
- **Producer detection** picks a normaliser by markers: Google Docs (`id="docs-internal-guid-…"` wrapper, `<b style="font-weight:normal">`), Word/Outlook (`mso-` styles, `MsoListParagraph`, `<!--[if !supportLists]-->` bullets), Notion (`notion-` classes or its metadata), Slack, Apple Notes/Pages (`Apple-converted-space`, `-apple-system` styles), Gmail (`gmail_` classes), Confluence, GitHub (`markdown-body`), VS Code (monospace `div`/`span` runs with `vscode-` or editor styles), generic web.
- **Common mapping:** `h1`–`h3` → headings; `h4`–`h6` → level 3; `p`/`div` blocks → paragraphs; `ul`/`ol`/`li` → lists with nesting from structure (and from `aria-level` and `margin-left`/`mso-list` depth when the source flattens lists); `blockquote`; `pre`/`code` → code block (language from `class="language-x"` when present); `hr`; `table` → table (feature 01 limits; larger tables keep the first 10 × 100 and a message says so); `details`/`summary` → toggle; `a[href]` (safe schemes only).
- **Marks from tags and styles:** `strong`/`b`, `em`/`i`, `u`, `s`/`del`/`strike`, `code`/`kbd`; and from inline `style` (`font-weight` ≥ 600, `font-style: italic`, `text-decoration` underline or line-through, monospace `font-family`).
- **Dropped:** colours, fonts, sizes, classes, ids, `script`, `style`, `iframe`, `object`, `svg`, form controls; unknown elements are unwrapped to their text. Images become their `alt` text (until feature 09). Link redirect wrappers are not unwrapped.
- **List repair:** consecutive paragraphs that Word or a plain-HTML source marks as list paragraphs become a list; list items containing block paragraphs are flattened to inline.
- **Whitespace:** collapse runs, drop zero-width and non-breaking artefacts, trim block edges.

### From plain text (`parse-text.ts`)

- **Lists.** A line is a list item when it starts (after indentation) with a bullet (`•`, `◦`, `▪`, `‣`, `·`, `–`, `—`, `-`, `*`) followed by a space, or a marker `1.`, `1)`, `a.`, `a)`, `i.`, `(1)`; consecutive items form a list; indentation (2–4 spaces or a tab per level) gives nesting; ordered versus bullet follows the marker. This is the fix for Slack lists that arrive as bullet-prefixed lines. Pasted lists always render with the **depth-based markers** (feature 01), whatever markers they used.
- **Markdown detection** `looksLikeMarkdown(text)`: true when at least one strong signal appears at a line start (heading `#`+space, fence ```` ``` ````, list marker with content, `>` quote, pipe-table header and separator) or two weak ones (`**x**`, `[x](url)`, `` `x` ``). One stray `*` or `#` does not count. When true, convert with `markdownToDoc` (it already handles tables and nested lists).
- **Everything else:** paragraphs split on blank lines; single newlines inside a paragraph become spaces, unless every line is a list item.
- **Code-like pastes:** if the source is a code editor (producer `vscode`) or the text is indented code with a fence, produce a code block.

### Where the content lands

- Inside a list item: continues the list; several pasted paragraphs become several items; a pasted list inside an item nests under it.
- Inside a **code block**: always the plain text, never structure.
- In a table cell: inline content only (blocks are joined with line breaks); a pasted table into a cell is flattened to text.
- In a **title or single-line field**: lines joined with spaces, trimmed.
- **URL over selected text:** a lone `http(s)` address pasted over a selection makes the selection a link to it (and nothing else changes).
- **Size:** content that would pass the document size limit is cut at a block boundary; the editor shows a quiet message "Pasted content was shortened to fit."
- **One paste is one undo step**; the result is saved like typed content (autosave now, operation queue from feature 04).

### Paste rule registry (`rules.ts`)

```ts
type PasteRule = {
  id: string;
  priority: number;                       // lower runs first
  test(data: ParsedClipboard, ctx: EditorContext): boolean;
  apply(view: EditorView, data: ParsedClipboard, ctx: EditorContext): boolean;
};
registerPasteRule(rule: PasteRule): void;
```

`ParsedClipboard` exposes `types`, `html`, `text`, `files`, `internal`. Feature 07 registers "note address → note link", feature 09 registers "image file → upload" and "URL → bookmark choice". The registry is empty of behaviour-changing rules in this feature.

---

## 6. Fixtures and the capture tool

The exact clipboard contents of each tool (above all **Slack's list copying**) must be **captured from the real tool**, not guessed (product spec §15.6).

- **Capture page:** `/dev/clipboard` (only when `NODE_ENV !== "production"`): a box that logs `clipboardData.types` and each flavour (`text/html`, `text/plain`, any custom type) as pretty JSON, with a "Copy as fixture" button.
- **Fixtures:** `tests/fixtures/clipboard/<tool>/<case>.json` = `{ tool, version, captured, types, html, text, expected }`. `expected` is the document the editor should produce, reviewed by hand. Cases per tool: heading and paragraph styles; bold/italic/strike/link; bulleted list with a nested list; numbered list with two nested levels; checklist; quote; code block and inline code; table; (Notion) toggle and callout.
- Tools: Slack (message composer and a copied message), Notion, Google Docs, Gmail, Apple Notes, Microsoft Word, a web page, GitHub markdown, VS Code.
- **Manual matrix:** `docs/research/YYYY-MM-DD-clipboard-matrix.md`, a table of tool × direction × case with pass/fail and a note per failure. It is part of the definition of done.

---

## 7. UI

- **Toast/inline message** for "Pasted content was shortened to fit" and "Table was cut to 10 columns and 100 rows."
- **Note overflow menu:** Copy note, Copy as Markdown (with the ⌘K equivalents).
- No settings. Plain paste is the standard `Cmd/Ctrl+Shift+V`. A short line in the editor's help ("Shortcuts") documents it.
- No visible change to the editor otherwise.

---

## 8. Rules and limits

- **Safety:** pasted HTML is parsed inert and rebuilt from allowed nodes; nothing is inserted as markup. Result passes `sanitizeDoc` (allowed nodes and marks, size, depth, safe links) on the client and again on the server when saved.
- **Images** are not copied out as HTML in this feature (images arrive in 09; copy of images is then limited by what other tools accept, product spec §15.6).
- **Browser differences:** `ClipboardItem` is not available everywhere; the `copy`/`cut` event handlers set flavours through `event.clipboardData` and work in all supported browsers. The internal flavour is best effort and may be dropped by some browsers; HTML is the fallback.
- **Performance:** serialising a 200 KB document must stay under 100 ms; parsing a 1 MB pasted HTML string under 300 ms (cap the input at 2 MB and fall back to plain text above it).
- **No network, no worker, no AI.** Works offline.
- **Privacy:** nothing is logged from the clipboard.

---

## 9. Tests

**Unit** (Vitest, fixtures from §6)
- Serialisers: every node and mark; tight lists; `type` per ordered level; nested lists; toggle, callout, table; Markdown output uses `1.`/`a.`/`i.`; plain-text and HTML agree on structure.
- `parse-html` per producer fixture → expected document; unsafe markup and styles dropped; `javascript:` links lose the link; huge tables cut; flattened Word lists repaired; `aria-level` nesting.
- `parse-text`: bullet glyph set, numbered and lettered markers, indentation → nesting, Slack-style bullet lines, Markdown detection true/false cases (single `*`, prose with `#`), pipe tables, code fences.
- Round trip: serialise → parse (own HTML and own Markdown) returns the same document for the full content set.
- Output always passes `sanitizeDoc`.

**E2E** (Playwright dispatches `ClipboardEvent` with a `DataTransfer` built from fixtures; reads clipboard flavours from a captured `copy` event)
1. Copy a mixed selection; assert the three flavours exist, HTML contains no `<p>` in `<li>`, no classes, ordered lists carry `type`.
2. Paste each fixture; assert the editor structure (lists stay lists, nested lists nest, headings, code, table).
3. A Slack-style bullet-lines paste becomes a bulleted list; `Cmd/Ctrl+Shift+V` pastes plain.
4. Paste into a list item, a code block, a table cell, a note title.
5. Copy and paste between two notes and into a task description: identical.
6. One paste, one undo.
7. A large paste is cut with the message.
8. Copy note and Copy as Markdown write the expected text.
9. Task description editor behaves the same.

**Manual:** the matrix in §6 on real tools.

---

## 10. Definition of done

- [ ] Compatibility matrix (product spec §15.7) completed on real tools and written to `docs/research/`; no case shows raw HTML or stray symbols
- [ ] A bulleted list copied from Slack and from Notion pastes as a bulleted list; a nested list keeps its nesting
- [ ] Copying a note section (heading, nested list, bold, link, code, table) into Notion and Google Docs arrives with the same structure; Slack shows what Slack can hold
- [x] Dayboard to Dayboard is identical, including tables, toggles and callouts
- [x] Plain paste, paste-in-list, paste-in-code and one-undo-step work
- [ ] Fixtures for every listed tool are committed and tested
- [x] Pasted documents always pass document validation; oversized pastes are cut with a message
- [x] The paste rule registry exists and is empty of behaviour changes beyond URL-over-selection
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [x] `agent_docs/clipboard-fidelity_v2.md` written and indexed

---

## 11. Out of scope (V2)

Copying images to other tools (limited by those tools; see feature 09); importing or exporting whole notes as Markdown or Word files; automatic conversion of a pasted emoji quote into a callout; auto-linking pasted plain URLs to bookmarks (09); drag-and-drop of text between apps beyond what the browser provides; a setting to choose paste behaviour.

---

## 12. As built (2026-10-07)

What differs from the sections above. The agent hand-off is `agent_docs/clipboard-fidelity_v2.md`.

- **Not done: the real-tool part.** The matrix (§6, §10) has its file (`docs/research/2026-10-07-clipboard-matrix.md`) with every cell "not run", and the fixtures are **reconstructed** from the tools' known markup, not captured (`tests/fixtures/clipboard/README.md`). The capture page `/dev/clipboard` exists to replace them. The definition-of-done items that need Slack, Notion, Google Docs and the rest (the matrix, the Slack and Notion list checks, a section copied into Notion and Google Docs, fixtures captured from real tools) and the full `pnpm` check list stay unticked until then.
- **Fixture format:** adds `note`, `extras` (other flavours, e.g. `vscode-editor-data`) and `case`; `captured` is `"reconstructed"` until replaced.
- **Paste hook:** `handleDOMEvents.paste` (not `handlePaste`), so Tiptap's link-on-paste and paste rules never run on top. Copy and cut are `handleDOMEvents.copy` and `cut`.
- **Plain-text flavour for an inline selection** is bare text, not Markdown (a bold word pasted into a search box has no asterisks). Code selections write raw text. Block selections are Markdown as specified.
- **HTML copy:** `class="language-x"` on `code` is the one class (the code language survives other tools). Tables are `<table><tr>…` without `tbody`. A list item with several paragraphs joins them with `<br>`. An empty last paragraph is dropped.
- **Paste, from HTML:** `td` stays a cell and `th` a header cell (Google Docs and Word write only `td`, so no header row comes from them). A Notion `figure.callout` becomes a callout; an emoji quote never does. A list item with several block paragraphs keeps them as paragraphs (flattening is only for a single one). A paragraph that starts with a bullet glyph, or one paragraph of glyph lines separated by `<br>`, becomes list items; "1. Intro" as a paragraph does not.
- **Paste, plain text:** a lettered or roman marker (`a.`, `ii.`) is believed only in a run of two or more list lines or beside a clearer one. `☐ ☑` become a checklist. Text that is Markdown is first rewritten to markers the Markdown converter knows (`•` → `-`, `a.` → `1.`), outside code fences. `markdown.ts` gained `maxListDepth` (paste keeps six levels, AI text keeps three), `tableCut` on its result and `\<` as an escape.
- **Where it lands:** adds "pasting blocks onto an empty line replaces that line", "a table, toggle or callout pasted into a list item or quote becomes lines of text" and "a pasted list at the end of an item nests under it". A multi-paragraph paste in a list item becomes items only when every pasted block is a paragraph.
- **Dayboard flavour:** scrubbed on read (node, mark and attribute whitelist, size and depth caps); an unsafe or newer-version flavour falls back to the HTML.
- **History:** pasting and cutting close the history group first, so one undo takes back exactly the paste or cut.
- **Size:** parsing stops once the paste is over the document limit; a single text block larger than the limit is cut inside the block. Measured in Chromium: a 1 MB HTML paste takes about 80 ms; serialising 570 KB of document takes about 30 ms.
- **Copy note:** tries a `copy` event through `document.execCommand("copy")` first (it carries every flavour, including the Dayboard one, in every browser), then `ClipboardItem`, then `writeText`. The title leads the HTML and Markdown; the Dayboard flavour carries the body only. In the command menu the two items show only on `/notes/<id>` (they send an event the open note listens for).
- **Titles:** the note title and the task title join pasted lines with spaces (`pasteSingleLine`). Other single-line fields are unchanged.
- **Not built:** the "Shortcuts" help line (no help screen exists to hold it).
- **New dev dependency:** `jsdom` (and `@types/jsdom`), for the HTML reader's unit tests only.

