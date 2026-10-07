# Feature: Clipboard fidelity

**Phase:** V2 (feature 02)
**Status:** In progress. The code, unit, integration and E2E tests are done. The compatibility matrix on real tools and real clipboard captures are not (see "What was deferred").
**Date:** 2026-10-07

## What was built

- **Copy and cut** write three flavours from one slice: clean semantic HTML, Markdown text (numbered items use the on-screen markers `1.` `a.` `i.`), and `application/x-dayboard-slice+json` (the exact slice, for a lossless paste back). A selection inside one text block copies as inline HTML and bare text, so pasting a word adds no paragraph.
- **Paste** reads, in order: Shift (plain text only), paste rules, Dayboard's flavour, HTML, plain text. HTML is read by a walker with per-tool hooks (Google Docs, Word, Notion, Slack, Apple, Gmail, GitHub, VS Code, generic); plain text becomes lists from bullet and number markers (Slack's text-only lists) or goes through the Markdown converter when it clearly is Markdown. Everything ends in `sanitizeDoc`.
- **Where it lands:** several paragraphs in a list item become items, a list nests under the item it is pasted at the end of, a code block takes text only, a table cell takes inline content only, a table pasted into a list item or quote becomes lines of text, an address over selected text makes a link, pasting blocks on an empty line replaces that line. One paste is one undo step (`closeHistory`). Too much is cut at a block boundary with "Pasted content was shortened to fit."
- **Copy note** and **Copy as Markdown** in the note's menu and the command menu; **note and task titles** join pasted lines with spaces; a **paste rule registry** (empty apart from URL-over-selection); `/dev/clipboard` capture page (development only).

## Why

The editor used ProseMirror's default clipboard code: Slack and Notion got raw editor HTML, and pasted lists from Slack arrived as bullet characters in paragraphs. The rule throughout: **nothing is inserted as markup**. Pasted HTML is parsed inert, rebuilt from allowed nodes, and checked again; the Dayboard flavour is scrubbed too, because any page can put anything on the clipboard.

## What was deferred

- **The real-tool compatibility matrix** (`docs/research/2026-10-07-clipboard-matrix.md`) was not run: it needs Slack, Notion, Google Docs, Word, Gmail and Apple Notes in front of a person. Its table is there with every cell "not run". The definition of done in the feature doc stays unticked for that item and for "fixtures captured from real tools".
- **The fixtures are reconstructed, not captured** (`tests/fixtures/clipboard/README.md`). Each file says `"captured": "reconstructed"`. They follow the markup these tools are known to write, but Slack in particular may differ. Capture the real thing with `/dev/clipboard`, replace the file, and fix `parse-html` if a test fails.
- The "Shortcuts" help line for plain paste: there is no editor help screen to put it in. Plain paste works as `Cmd/Ctrl+Shift+V`.
- Other single-line fields (project name, quick capture) still use the browser's paste; only the note title and the task title were changed.
- Not tested: Safari, Firefox, a phone, and the "Dayboard flavour" through a real clipboard in browsers other than Chromium (HTML is the fallback).
- Images in pasted HTML become their alt text; files are left alone (feature 09). Note-address and bookmark rules are for features 07 and 09.

## Related files

- `src/lib/editor/clipboard/`: all pure except `index.ts`. `serialize-html.ts`, `serialize-markdown.ts`, `copy.ts` (the three flavours); `parse-html.ts` + `producers/`; `parse-text.ts` + `list-lines.ts`; `lists.ts` (one nested-list builder for every source); `fit.ts` (flattens what cannot go where it is headed); `budget.ts` (size limit); `slice.ts` (the Dayboard flavour, scrubbed); `paste.ts` (order of precedence); `rules.ts` (registry + URL rule); `index.ts` (the ProseMirror plugin: copy, cut, paste, where it lands).
- `src/components/editor/clipboard-extension.ts` (Tiptap wrapper, priority 1000), `copy-note.ts`, `single-line-paste.ts`; `note-editor.tsx` (menu items, `COPY_NOTE_EVENT` listener); `command-menu.tsx` (Copy note / Copy as Markdown on `/notes/<id>`).
- `src/lib/editor/markdown.ts`: new `maxListDepth` option (AI keeps 3, paste keeps 6), `tableCut` on the result, `\<` is now an escape. `limits.ts`: `tableCut` and `pasteShortened` messages. `schema.ts` exports `sanitizeAttrs`, `sanitizeMarks`, `NODE_TYPES`.
- `src/app/dev/clipboard/page.tsx`, `src/components/dev/clipboard-capture.tsx`: the capture page (404 in production).
- Tests: `tests/unit/clipboard-{fixtures,serialize,text,html,roundtrip,slice-rules,editor}.test.ts` (jsdom; `clipboard-editor` drives a real ProseMirror editor), `tests/fixtures/clipboard/<tool>/<case>.json`, `e2e/clipboard.spec.ts`.

## Hand-off notes

- **Paste is a `handleDOMEvents.paste` handler**, not `handlePaste`: it runs before ProseMirror parses the clipboard itself, and before Tiptap's link-on-paste and paste rules. Transactions deliberately do **not** set `uiEvent: "paste"`, so Tiptap's own paste rules (which turn `**x**` text into bold) never run on top. They carry `preventAutolink`.
- **Copy is not ProseMirror's serializer.** Drag and drop out of the editor still uses it. The Dayboard flavour keeps open ends; `Slice.fromJSON` rebuilds it.
- **Adding a source tool:** put its fixture in `tests/fixtures/clipboard/`, then add a `Producer` under `producers/` (detection, and only the hooks it needs) and register it in `producers/index.ts`. Most tools need nothing beyond the common rules. The lists of all sources are flattened to `FlatItem`s and built by `buildNestedLists`: do not build nested lists anywhere else.
- **Adding a paste rule** (feature 07 note address, 09 image and bookmark): `registerPasteRule({ id, priority, test, apply })`; lower priority runs first, the URL rule is 100.
- **The editor keeps an empty last paragraph after a list or table** (Tiptap trailing node). Copy drops it from HTML, tests ignore it. Ctrl/Cmd+End does not reach it on a Mac: use ArrowDown.
- **History:** a paste after typing is its own undo step. Typing straight after a paste may join the paste's step (ProseMirror's grouping).
- **Whitespace:** a one-line fragment (`<span>big </span>`) keeps its edge spaces so it fits into a sentence; every other block is trimmed.
- **Limits:** the walker stops reading once the paste is larger than a document (a 1 MB paste reads in about 80 ms in Chromium), then `fitToBudget` cuts at a block boundary; a single text block bigger than the whole limit is cut inside the block.
- **`jsdom` is a dev dependency** (tests only, via `// @vitest-environment jsdom`); `parse-html` needs a real `DOMParser`.
- **Copy note order of attempts:** a `copy` event through `document.execCommand("copy")` (carries all flavours in every browser, Safari wants a selection), then `ClipboardItem` (HTML and text), then `writeText`. The title leads the HTML and Markdown; the Dayboard flavour carries the body only, since the title is a separate field.
- **Decisions to know:** inline selections write bare text as plain text (not Markdown, so a bold word pasted into a search box has no asterisks); code selections write raw text; `class="language-x"` is the only class on copied HTML (so code language survives Notion and GitHub); a list item with several paragraphs copies them joined by `<br>`; a pasted Notion callout becomes a callout but an emoji quote never does; HTML tables keep `td` as cells and `th` as header cells (Google Docs and Word write `td` only, so no header row).
- Related: `editor-blocks-and-lists_v2.md` (nodes, limits, `markerFor`), `notes-projects-tags_v1.md`, `ai-writing-and-planning_v1.md` (`markdown.ts`).
