# Miscellaneous Feature — AI Writing and Planning

Three streamed AI features built on feature 05's foundation. They add no new product area; each adds one entry point to a screen that already exists.

| Key | Feature | Where it lives | Output |
|---|---|---|---|
| **A** `GENERATE_CONTENT` | **Generate with AI**: write a note or a task description from a prompt | Notes (page, new note, note menu, ⌘K), task description | Streamed Markdown, shown formatted as it arrives, then converted to rich text |
| **B** `PLAN_DAY` | **Plan my day**: propose 3–5 tasks for today, in order | Today | Streamed proposals, one row at a time |
| **C** `EDIT_SELECTION` | **Writing help**: Improve, Shorten, Fix grammar, Continue on selected text | The note editor's selection menu | Streamed replacement text, shown before/after |

**Depends on:** 01–05 (everything it touches exists). **Independent of:** 06 and 07, but it uses 07's design system (`DESIGN.md`: `ai-panel`, motion budget, red-is-rare) and must not break its tests.

Source: feature 05 §1–§10 (pipeline, limits, "preview and confirm"), feature 03 (notes, autosave, versions), feature 02 (task description), feature 04 (Today, Focus), UI/UX spec §13 (AI states), `DESIGN.md` (AI panel, Motion).

---

## 1. Scope

- **A. Generate with AI.** The person writes a prompt (anything), picks a length (Short, Standard, Detailed), and the AI writes the content. For a **note** it can also write the title. It can read the **current note** (or the current task) as context. The text streams in real time, formatted as rich text while it arrives. Nothing is saved until the person confirms.
- **B. Plan my day.** One button on Today. The AI proposes 3–5 tasks for today in a sensible order, drawn from overdue, due-today and high-priority items. Proposals stream in one by one. The person ticks or unticks, chooses the Focus, and confirms. Confirming sets due dates and the Focus.
- **C. Writing help.** Select text in a note, choose Improve, Shorten, Fix grammar or Continue, watch the replacement stream beside the original, then Replace or Discard. Replacing keeps the rest of the document, and its block structure, intact.

**Hard rules carried over from feature 05 (they apply to all three):**

1. **Generate → Preview → Confirm → Persist.** No AI path writes data before an explicit click. Persisting goes through the normal Server Actions (`createNote`, `updateTaskDescription`, `saveNoteContent`, `updateTask`, `setFocus`) or the editor's own transactions, so AI output gets the same validation and ownership checks as typing.
2. Every route runs the shared pipeline (`openGate`: sign-in, AI on, Zod, limits), loads records **by id and owner**, treats workspace text as data inside `<data>` blocks, and records `ai_usage` with no prompt or output text.
3. Works with the mock provider and a real one. CI makes zero paid calls.
4. AI never blocks the page. Every surface has Ready, Generating, Complete, Failed with Retry (UI/UX §13).
5. No sparkle icon, no AI badge, no chat sidebar. Buttons are plain verbs. AI output sits in the tinted `ai-panel` with the words "AI-generated".

**Streaming for all three.** Each route returns newline-delimited JSON events (the format feature 05 already uses for Summarize and Ask), so the browser shows output as it is produced.

---

## 2. What exists today (assessment)

Read before building. File paths are real as of 2026-10-03.

| Area | What is there | Gap this feature fills |
|---|---|---|
| AI pipeline | `src/lib/ai/gate.ts` (`openGate`, `authorize`, `enforceLimits`, `ndjsonResponse`), `index.ts` (`streamText`, `generateStructured`), `usage.ts`, `limits.ts`, `prompts.ts` (`*_V1`), `providers/mock.ts`, `providers/sdk.ts` (Anthropic or Gemini) | No `maxOutputTokens` on calls; a stream's end is recorded as an error when the person cancels; `StreamEvent` has only `text`, `sources`, `error`, `done` |
| Streaming UI | `components/ai/use-ai.ts` (`useAIStream` for text + sources), `ai-client.ts` (`streamAI`), `ai-ui.tsx` (`AiPanel`, `GrowingAiPanel`, `StreamCaret`, `AiFailureNotice`, `AiGenerating`) | A hook for events other than text and sources; a preview that looks like the editor |
| Editor | `components/editor/rich-text-editor.tsx` loads `rich-text-editor-inner.tsx` (Tiptap, StarterKit, TaskList) with `dynamic()`; `toolbar.tsx` has `FormatToolbar` and `SelectionMenu` (a `BubbleMenu`, **desktop only, notes only**) | The dynamic wrapper exposes **no editor instance**, so nothing outside can insert content or replace a selection. Autosave listens to every edit, so streaming straight into the document would save half a draft |
| Document model | `lib/editor/schema.ts` allows only: paragraph, heading 1–3, bullet/ordered list, listItem, taskList, taskItem, blockquote, codeBlock, horizontalRule, hardBreak; marks bold, italic, underline, strike, code, link (http/https/mailto). `sanitizeDoc`/`richTextSchema` validate every save. 200,000 bytes, depth 20 | A converter from the AI's text to exactly this model. There is **no table or image node**, so those must be converted, not passed through |
| Notes | `createNote({title, contentJson, projectId, linkTaskId})`, `saveNoteContent`/`saveNoteTitle` with `baseVersion` (optimistic concurrency), `useNoteSync` (debounced autosave, conflict banner, local draft), `note-editor.tsx` (summary panel, `reseed` remount, `afterMenu` handoff for the overflow menu) | Entry points; applying content to an open note without confusing sync |
| Task description | `components/tasks/description-editor.tsx` (`useAutosave`, `onLiveChange`), `updateTaskDescription`, `task-ai.tsx` (AI actions, rewrite dialog that remounts the editor via a key) | A "Generate" action and an insert path |
| Today | `getTodayData`, `bucketToday`, `loadOverdueTasks`, `setFocus` (human only), `updateTask`, `FocusHero`, `AiSuggestionSlot` (brief + "Help me clean up") | A planning candidate loader, the route, the dialog |
| Limits | 10 per minute, 100 per day, rate-limited attempts recorded but not counted | Each generation, regeneration and edit counts as one action; this will consume the free tier faster (see §13) |

**Findings that shape the design**

1. **Preview is a separate surface, not the document.** Streaming into the live editor would trigger autosave and (for notes) version bumps mid-draft, and would write before confirm. So output streams into a **read-only preview rendered with the same editor styles**, and is applied in one step on confirm.
2. **Markdown, not JSON, for text features.** Streaming Markdown is robust on free models, which are weaker at strict JSON. A converter we control maps it to the allowed node set. Plan my day is the one structured case, and it streams one JSON object per line so partial output is still usable.
3. **The editor needs a handle.** The dynamic wrapper gets an `onEditorReady(editor)` prop (and `onEditorDestroy`), so insert and replace use ProseMirror transactions (one undo step).
4. **No new dependency.** The Markdown subset is small and must end in our own schema, so a hand-written converter is safer than a general Markdown library plus sanitizing.

---

## 3. Data model

No new tables.

- **`ai_feature` enum:** add `GENERATE_CONTENT`, `PLAN_DAY`, `EDIT_SELECTION`. One migration (`0006_ai-writing-planning.sql`), three `ALTER TYPE … ADD VALUE` statements (each its own statement). Apply to dev and test (`pnpm db:migrate`, then with `DATABASE_URL` for `dayboard_test`). Update `AI_FEATURES` in `src/lib/ai/types.ts` and `PROMPT_VERSIONS`.
- **`ai_usage`:** unchanged. One row per call. A **cancelled stream counts as `SUCCESS`** (the provider worked and quota was used); only provider failures are `PROVIDER_ERROR`.
- **Nothing is stored** from the prompt, the context or the output. Generated content exists only in the browser until confirmed, then in the note or task like any typed text.

---

## 4. Shared foundation (build first)

### 4.1 Rich-text conversion: `src/lib/editor/markdown.ts`

```ts
markdownToDoc(markdown: string, options?: { final?: boolean }): TiptapDoc
```

Pure, no I/O, no dependencies. Output always passes `sanitizeDoc`.

| Markdown | Becomes |
|---|---|
| `#`, `##`, `###` (and `####`–`######`) | `heading` level 1–3 (deeper levels become level 3) |
| blank-line separated text | `paragraph` (a single newline inside a paragraph becomes a space) |
| `- ` or `* ` | `bulletList` of `listItem` (indent 2–4 spaces = nested list, up to depth 3) |
| `1. ` | `orderedList` (`start` kept, 1–1,000,000) |
| `- [ ]` / `- [x]` | `taskList` of `taskItem` (`checked`); **not nested** (the editor config forbids it), deeper levels flatten |
| `> ` | `blockquote` containing paragraphs |
| fenced ```` ``` ```` with optional language | `codeBlock` (`language` ≤ 32 chars) |
| `---`, `***` | `horizontalRule` |
| `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `code` `` | marks `bold`, `italic`, `strike`, `code` |
| `[text](url)` | `link` mark **only if** `isAllowedLink(url)`; otherwise just the text |
| tables, images, HTML, footnotes | **Converted, never passed through:** a table becomes a bulleted list, one item per row (`cell · cell · cell`) after a bold header line; an image becomes its alt text; HTML tags are stripped to their text |

**Streaming rule (`final: false`).** The input is whatever has arrived so far. Complete lines are parsed normally. The **last, unterminated line** is shown as plain paragraph text (no half-formed `**` or `[`) and re-parsed when its newline arrives. An open code fence stays open and shows its lines so far. When the stream ends, the caller runs it once more with `final: true`. The function must never throw on any input; unknown syntax degrades to paragraph text.

**Limits.** Output over 200,000 bytes is cut at a block boundary and the preview says "Shortened to fit." (Generation caps are far lower, §5.)

**Underline** has no Markdown form, so the AI never produces it. The editor still offers it to people.

### 4.2 Title and body split: `src/lib/ai/generate.ts`

When a title is requested, the model's first line is `TITLE: <text>`, then a blank line, then the Markdown body. `splitTitle(buffer)` returns `{ title, body, done }`: it waits for the first newline, trims, caps the title at 300 characters (`NOTE_TITLE_MAX`), strips Markdown marks and quotes, and falls back to "no title" if the first line isn't `TITLE:` (the body then starts at the top).

### 4.3 Stream events and hooks

- Extend `StreamEvent` in `src/lib/ai/types.ts`:
  - `{ type: "title"; text: string }` (A, sent once when the first line completes)
  - `{ type: "proposal"; item: PlanProposal }` (B, one per valid proposal)
  - `{ type: "summary"; text: string }` (B, one sentence, optional)
  - existing `text`, `error`, `done` stay.
- Generalise `useAIStream` (or add `useAIEvents<T>`) so a surface can supply a reducer for events. The existing Summarize and Ask behaviour must not change.
- `ndjsonResponse` stays as is. `streamText` gains `maxOutputTokens` and treats a client abort as a normal end (§3).
- **Provider interface:** `CallOptions` gets `maxOutputTokens?: number`; `providers/sdk.ts` passes it to the SDK; the mock ignores it. Default 1,200 for existing features so nothing changes for them.

### 4.4 The editor handle: `RichTextEditor`

Add to `RichTextEditorProps` (and forward through the dynamic wrapper):

```ts
onEditorReady?: (editor: Editor) => void;   // called when the editor exists
onEditorDestroy?: () => void;
```

Hosts keep the instance in a ref (read only inside handlers, never during render). All AI insertions use `editor.chain()` / transactions so **one Undo restores the document** and autosave sees an ordinary edit.

### 4.5 Document preview: `components/ai/doc-preview.tsx`

A read-only Tiptap instance (`editable: false`, same extensions) inside `.rich-text` / `.rich-text-document`, so the preview is **styled exactly like the editor** (same fonts, headings, lists, checklists, quotes, code). Fed by `markdownToDoc(text)`; content is set at most every 80 ms (throttled) while streaming, and once more on completion. It scrolls to the bottom while streaming unless the person has scrolled up. It is `aria-busy` while streaming and is **not** a live region (a screen reader would otherwise read every chunk); a separate status line announces "Writing", then "Draft ready".

### 4.6 Apply helpers: `components/editor/ai-apply.ts`

Pure functions over a Tiptap `Editor`, each one transaction:

- `insertDocAtCursor(editor, doc)`, `appendDoc(editor, doc)`, `replaceAll(editor, doc)`
- `replaceSelection(editor, range, paragraphs | doc)` (§8.3)

Each returns `{ ok: false, reason }` instead of throwing (for example, the document changed since the preview started).

---

## 5. Feature A — Generate with AI

### 5.1 Behaviour

**Inputs (the panel):**

| Input | Rule |
|---|---|
| Prompt | Required, 1–2,000 characters, anything. `⌘/Ctrl+Enter` generates. |
| Length | **Short** (about 80–150 words, a few lines, no headings), **Standard** (about 250–400 words, headings where they help), **Detailed** (about 700–1,200 words, structured with `##`/`###`, lists, and a checklist of next steps when relevant). Default Standard. Output caps: 600, 1,500, 4,000 tokens. |
| Use the current note/task as context | On by default when there is saved content. A note sends its saved title and text (up to 20,000 characters); a task sends its title, status, due date, subtask titles and description. Off sends only the prompt. |
| Write the title too (notes only) | On when the note is empty or "Untitled"; off when it already has a title. After generation it becomes a checkbox in the preview ("Use this title"), so the person decides. |
| Language | The model answers **in the language of the prompt**. (Stated in the system prompt; no setting.) |

**Targets:**

- **New note:** creates a note with the generated title and content.
- **Current note:** inserts **at the cursor**, **at the end**, or **replaces everything** (a separate, second choice, because it is destructive; see §5.5).
- **Task description:** inserts at the end or replaces the description (the title is never changed).

**Flow:** Ready (prompt + options) → Generating (preview streams, caret, **Stop**) → Complete (preview + buttons) → apply. Complete offers: **Create note** or **Insert** (with the placement choice), **Regenerate** (same prompt, counts as another action), **Edit prompt** (back to Ready, text kept), **Discard**. Failed shows the standard failure text with **Retry** and keeps the prompt.

### 5.2 Entry points

| Where | Control | Result |
|---|---|---|
| Notes page header | "Write with AI" beside "New note" | `/notes/new?ai=1` |
| New note page (empty editor) | A line under the empty editor: "Write with AI" | Opens the panel on the page |
| An open note's overflow menu | "Generate with AI" (above Summarize) | Opens the panel above the editor; target is this note |
| ⌘K, Create mode | "Write a note with AI" | `/notes/new?ai=1` |
| Task detail, Description heading | "Generate with AI" button | Opens the panel inside the task detail; target is this task |

`/notes/new?ai=1` renders the editor with the generate panel open and focused on the prompt. The note is **not created** until Create note is clicked (preserving "abandoned new notes leave nothing behind"). If the note was reached from a project (`?project=`) or a task (`?task=`), the created note keeps them. All five entries are hidden when AI is off or unavailable.

### 5.3 Route: `POST /api/ai/generate-content`

Request (Zod, strict, in `src/lib/validations/ai.ts`):

```ts
{
  target: "note" | "task" | "new",
  targetId?: uuid,            // required for note/task; absent for "new"
  prompt: string,             // 1..2000
  length: "SHORT" | "STANDARD" | "DETAILED",
  withTitle: boolean,         // only honoured for note/new
  useContext: boolean
}
```

Pipeline: the shared steps 1–4, then **load context by id and owner** (a note or task that isn't the caller's is `NOT_FOUND`; the client never sends the stored text), build the prompt (`GENERATE_CONTENT_V1`), stream, record usage. Context is wrapped in `<data name="context">` and the system prompt says to treat it as material, never instructions. A note that is empty with `useContext: true` simply has no context block.

Response events: optional `title`, then many `text` (Markdown body deltas), then `done` (or `error`). The server splits the title (§4.2) so the client never sees `TITLE:`.

System prompt rules: write only in the allowed formatting (headings `#`–`###`, paragraphs, `-`/`1.` lists, `- [ ]` checklists, `>` quotes, fenced code, bold/italic/code/links, `---`); **no tables, images or HTML**; no preamble or sign-off ("Here is…"); no emoji unless asked; answer in the prompt's language; use only facts from the prompt and context, and say so rather than inventing details; stay within the length target.

### 5.4 Applying to the editor

- **New note:** `createNote({ title?, contentJson, projectId?, linkTaskId? })`, then navigate (replace) to `/notes/{id}`. The document is `sanitizeDoc`-validated by the action as always.
- **Current note:** flush pending saves first (`sync.flush()`), then apply with `insertDocAtCursor` / `appendDoc` / `replaceAll`. That is one ordinary edit, so `useNoteSync` saves it with its normal version check. A conflict banner, if it appears, behaves as today. If "Use this title" is ticked and a title is suggested, it goes through the existing title path (`onTitleChange`).
- **Task description:** same helpers on the description editor (a handle on `DescriptionEditor`); autosave via `updateTaskDescription`.
- If the editor was closed or the document changed in a way that invalidates the target while the panel was open, Insert is disabled with "The note changed. Regenerate or copy the text." and **Copy** (plain text) is offered.

### 5.5 Replace everything

A second explicit step: choosing "Replace everything" shows "This replaces the whole note. You can undo with ⌘Z." and a **Replace note** button. After applying, a toast "Note replaced." has **Undo** (it runs the editor undo, and the sync saves the restored content). Never the default.

---

## 6. Feature B — Plan my day

### 6.1 Behaviour

A **Plan my day** button on Today (in the header actions, beside the progress ring). It opens a dialog that streams a proposed plan. No data changes until **Plan N tasks** is clicked.

**Candidates (server-side, owner-scoped):** open, top-level, non-archived tasks that are overdue, due today, or `HIGH` priority with no date or a future date. Capped: 15 overdue (oldest first), 15 due today, 10 high-priority others, 40 total. Each is sent as `id | title | due | priority | status | project | subtasks done/total`. Today's date, weekday and time zone are sent. **Task titles are sent** (the Today daily brief sends numbers only), so the data notice in Settings changes (§11).

**Selection (by the model, validated by us):** 3–5 tasks, ordered by what to do first, favouring: the oldest overdue that is still plausible, due-today items, then high-priority. Each has a reason of at most 100 characters. A single optional first line is a one-sentence summary of the day.

**Nothing to plan:** with no candidates the model is **not called**, no quota is used, and the dialog says "Nothing needs planning. Your day is clear."

### 6.2 Streaming protocol

The model is asked to emit **one JSON object per line** (JSON Lines), nothing else:

```text
{"summary":"Two overdue items first, then today's report."}
{"taskId":"<uuid>","reason":"Oldest overdue and high priority."}
{"taskId":"<uuid>","reason":"Due today."}
```

`parsePlanLines(buffer)` (pure, `src/lib/ai/plan.ts`) yields complete lines only. Each line is parsed and validated with Zod; **a line that fails is skipped**, not fatal. Proposals for a `taskId` that was not sent, a duplicate id, or a sixth proposal are dropped. For each valid proposal the route sends `{ type: "proposal", item }` where the item is built **from our own data** (title, due date, priority, project) plus the model's `reason`, so the model can never change a title or date. If the stream ends with zero valid proposals, the route sends `error` (`AI_PROVIDER_ERROR`), the dialog shows Failed with Retry. Fewer than three valid proposals is allowed.

### 6.3 Route: `POST /api/ai/plan-day`

Request: `{}` (strict). Pipeline: steps 1–4, load candidates, build the prompt (`PLAN_DAY_V1`), stream, record usage. Uses the default model.

### 6.4 Dialog and apply

- **Rows** appear one at a time as they stream (fade and slide 4px, `snappy` layout; reduced motion: fade only). Each shows a checkbox (ticked), the title, a due chip (red-is-rare rules apply; at most one filled red chip), the reason, and a **Focus** radio. The first proposal is the default Focus.
- **Reorder** is not offered (the order is the AI's suggestion; the person unticks to remove).
- **Plan N tasks** applies, in order:
  1. For each ticked task whose due date is not already today, `updateTask({ id, dueDate: today })` (existing action). Overdue items become due today.
  2. `setFocus({ taskId })` for the chosen Focus (existing action; it is still the person's explicit choice, never the AI's alone).
- A toast "Planned N tasks. Focus: {title}" with **Undo**, which restores each previous due date with `updateTask` and the previous Focus with `setFocus`. Partial failure: successes stay, the toast says "N tasks couldn't be updated."
- Today refreshes (`router.refresh()`), so Overdue, Today and the Focus card show the result.

**Limit, stated plainly in the dialog footer:** "This is a shortlist, not a schedule. It doesn't set times." The order is shown in the preview and used for the Focus; Today's own list order is unchanged. Time-boxing needs estimates or the V2 calendar (§14).

---

## 7. Feature C — Writing help

### 7.1 Behaviour

| Mode | Input sent | Output |
|---|---|---|
| **Improve** | the selected text | clearer, better-flowing text, same meaning, similar length |
| **Shorten** | the selected text | about half the length, keeping the key points |
| **Fix grammar** | the selected text | corrected spelling, grammar and punctuation only; wording unchanged otherwise |
| **Continue** | the **text before the cursor or selection** (up to 2,000 characters; the selection counts as the end) | new text that continues it, about one to three paragraphs; **inserted after**, never replacing |

For Improve, Shorten and Fix grammar, **only the selected text is sent** (up to 6,000 characters; longer selections are refused with "Select a shorter passage."). Continue is the one mode that needs surrounding text, and the UI says so ("Uses the text before your cursor.").

### 7.2 Entry points

- **Desktop:** the floating selection menu (`SelectionMenu`) gains one ordinary button, **Improve writing ▾**, opening a menu with Improve, Shorten, Fix grammar, Continue. For Continue with no selection, a collapsed cursor at the end of a paragraph shows the same menu from a small "Continue writing" control in the formatting toolbar.
- **Phone and keyboard:** the selection menu does not show on touch, so the formatting toolbar gets the same **Improve writing ▾** button (notes only). Keyboard: the menu opens from the toolbar button; `⌘/Ctrl+Shift+J` opens it with the current selection (documented in the shortcuts list).
- **Notes only.** Task descriptions get Generate (A) but not Writing help.
- Hidden when AI is off or unavailable.

### 7.3 Route: `POST /api/ai/edit-selection`

```ts
{ mode: "IMPROVE" | "SHORTEN" | "FIX_GRAMMAR" | "CONTINUE", text: string /* 1..6000 */, before?: string /* CONTINUE only, ≤2000 */ }
```

The selected text is the person's own live text from the editor (it may be unsaved), so unlike a stored record it comes from the client; this is deliberate and bounded (§1 rule 2 is about stored records). The route never reads the workspace. Strict schema: unknown keys (a client-sent user id) are rejected. Prompt `EDIT_SELECTION_V1` (one system prompt per mode); the selection goes in a `<data name="selection">` block. The model returns **plain text only, in the selection's own language**, with blank lines between paragraphs, no quotes, no preamble, no Markdown unless the selection had list or code characters. Fast model (`AI_MODEL_FAST`), `maxOutputTokens` about twice the input, capped at 2,000. Streams `text` events.

### 7.4 Preview and replace

A floating panel anchored under the selection (desktop) or a bottom sheet (phone), `ai-panel` styled, "AI-generated":

- **Before** (the original, from the editor) and **After** (streaming), side by side from 768px, stacked below. A caret and a **Stop** button while streaming.
- Buttons when complete: **Replace** (primary), **Regenerate**, **Discard**. For Continue the primary is **Insert below**. `Enter` confirms when focus is not in a text field; `Esc` discards (and stops a stream).
- **Stale guard.** The preview remembers the selection range and the document's change counter at the start. If the editor content in that range changed meanwhile (typing, collaboration is not in V1, but undo/redo or autosave reload can), Replace is disabled with "The text changed. Regenerate."

### 7.5 Replacing without losing formatting

Applied by `replaceSelection(editor, range, after)` in **one transaction** (so ⌘Z restores the original and its formatting exactly):

1. **Block structure is kept.** The selection is split into its text blocks. If the model's paragraph count equals the block count, each block's text is replaced **in place** (a list item stays a list item, a heading stays a heading, a checklist item keeps its tick).
2. If the counts differ (Shorten often merges), the whole selected range is replaced by the new paragraphs as plain paragraphs, inside the first block's type when it is a list item.
3. **Inline marks.** The replacement text takes the marks of the **first character** of the block it replaces (so a bold sentence stays bold). Links inside the selection are kept only when the replacement still contains the exact link text. When the selection had mixed marks, the preview shows one quiet line: "Formatting inside the selection is simplified."
4. **Continue** inserts new paragraphs after the selection (or cursor) block, with no marks, as ordinary paragraphs.
5. Nothing outside the range is touched. Selections that cross a code block or horizontal rule are refused for Improve/Shorten/Fix grammar ("Select text only, without code or dividers.").

The same code path runs for notes with autosave on, so the save, version bump and conflict handling are the existing ones.

---

## 8. Server contract summary

| Route | Method | Model | Stream events | Context loaded | Writes |
|---|---|---|---|---|---|
| `/api/ai/generate-content` | POST | default | `title`?, `text`…, `done` | note or task **by id + owner** | none |
| `/api/ai/plan-day` | POST | default | `summary`?, `proposal`…, `done` | candidate tasks (owner) | none |
| `/api/ai/edit-selection` | POST | fast | `text`…, `done` | none (client text, bounded) | none |

Common: `requireUser()` → `AI_DISABLED` check → Zod → `checkLimits` (10/min, 100/day; rate-limited attempts recorded, not counted) → provider → `ai_usage`. Errors use the shared JSON shape (`UNAUTHENTICATED` 401, `AI_DISABLED` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429 with `retryAfterSeconds`). A failure after the stream starts is an `error` event. Client abort ends the provider call and records `SUCCESS`.

New files: `src/app/api/ai/{generate-content,plan-day,edit-selection}/route.ts`; additions to `src/lib/validations/ai.ts`, `src/lib/ai/{types,prompts,schemas}.ts`, `src/db/queries/ai.ts` (`loadPlanCandidates`), `providers/mock.ts`, `providers/sdk.ts`.

---

## 9. UI

Follow `DESIGN.md` and feature 07: the `ai-panel` tint with the label "AI-generated", ghost verbs, no icons that imply AI, 12px radii, the motion budget (at most two feature animations per screen; streaming growth is one), reduced motion respected.

### 9.1 Generate panel (`components/ai/generate-panel.tsx`)

```text
┌ ai-panel ────────────────────────────────────────────────┐
│ AI-GENERATED                                              │
│ [ What should it write?                              ]    │
│   ( Short ) (• Standard ) ( Detailed )                     │
│   [x] Use this note as context   [x] Write the title too  │
│                                        [ Generate ]       │
└───────────────────────────────────────────────────────────┘
```

- Length is a three-option segmented control. Options are checkboxes with labels.
- Generating: the same panel shows the **doc preview** (§4.5) below the prompt, a "Writing…" status, a caret, and **Stop**. The panel grows with `GrowingAiPanel`.
- Complete: preview plus the action row. The suggested title (if any) appears above the preview as an editable single-line field with the **Use this title** checkbox.
- The placement choice (**At cursor / At the end / Replace everything**) is a small menu on the primary button for existing notes.
- On a phone the panel is full width above the editor; the prompt textarea is 16px.

### 9.2 Plan dialog (`components/today/plan-day.tsx`)

Standard dialog (≤ 620px, full height scrolling on phones): title "Plan my day", the one-line summary (streams in), the proposal list, the footer note about shortlist-not-schedule, **Cancel** and **Plan N tasks**. `Enter` confirms; `Esc` closes and stops the stream.

### 9.3 Writing help panel (`components/editor/ai-selection-menu.tsx`, `ai-edit-panel.tsx`)

The button joins the existing bubble menu (separated by a hairline). The panel is a `Popover` anchored to the selection; positioned with the existing floating-ui setup; on phones a bottom sheet above the keyboard.

### 9.4 States and copy

| State | Copy |
|---|---|
| Ready (A) | "Describe what to write" placeholder: "e.g. A one-page brief for the Acme rebrand" |
| Generating | "Writing…" (A, C), "Planning…" (B) |
| Complete | Buttons only; no success toast |
| Failed | "Couldn’t write that. Nothing was changed." / "Couldn’t make a plan. Nothing was changed." / "Couldn’t edit that text. Nothing was changed." with **Retry** |
| Rate limited | The shared amber note: "That’s a lot at once. Try again in N seconds." with **Dismiss** |
| Empty plan | "Nothing needs planning. Your day is clear." |
| Stale (C) | "The text changed. Regenerate." |

### 9.5 Accessibility and keyboard

- Preview is `aria-busy` while streaming; a visually hidden status says "Writing" then "Draft ready". No per-chunk announcements.
- All controls reachable by keyboard; focus returns to the trigger on close; `⌘/Ctrl+Enter` generates; `Esc` stops then closes.
- Checkboxes, radios and buttons are ≥ 44px on touch; contrast per feature 07 (the `ai-surface` pairs are already tested).
- Reduced motion: no slide on proposal rows or panel growth; caret static.

### 9.6 Settings → AI notice

Update the data-processing text: "Generating content also sends your prompt and, if you allow it, the note or task you're working in. Planning sends the titles of your overdue and due tasks. Writing help sends only the text you select." (Gemini free-tier line unchanged.)

---

## 10. Prompts and the mock provider

`prompts.ts` adds `GENERATE_CONTENT_V1`, `PLAN_DAY_V1`, `EDIT_SELECTION_V1` (system prompts and builders) with the shared `<data>` rule. Each records its version in `ai_usage.prompt_version`.

The mock returns deterministic, input-derived output so tests can assert on it, and honours `[mock:error]` and `[mock:slow]` in the prompt or text:

- **Generate:** a body that exercises every supported block: `TITLE: …` (when asked), a heading, a paragraph with `**bold**`, `*italic*` and a `[link](https://example.com)`, a bulleted list with a nested item, a numbered list, a `- [ ]` checklist, a `>` quote, a fenced code block, `---`, and a **table** (to prove conversion). Length changes the number of paragraphs (Short 1, Standard 3, Detailed 6). It streams in 14-character chunks as Summarize does.
- **Plan:** the first N of the sent candidates in a fixed order, as JSON Lines, including one **unknown id** line and one **malformed** line (so the filters are exercised).
- **Edit:** Improve appends " (improved)" per paragraph; Shorten keeps the first sentence of each; Fix grammar fixes a fixed set of typos; Continue returns two paragraphs.

---

## 11. Tests

### Unit

- `markdown.ts`: every block and mark in §4.1; nesting depth; the table, image and HTML conversions; unsafe links dropped (`javascript:`); headings deeper than 3; ordered list `start`; checklist flattening; code fence with and without a language; **streaming states** (a document fed one character at a time never throws, never produces an invalid doc, and converges to the same result as the whole text); oversize input; empty input; output always passes `sanitizeDoc`.
- `splitTitle`: with and without `TITLE:`, long titles, titles with Markdown marks, title arriving across chunks.
- `parsePlanLines`: valid, malformed, unknown id, duplicates, more than five, summary line, partial last line, zero valid proposals.
- `replaceSelection` planning (pure part): equal block counts map one to one; unequal counts replace the range; first-character marks are inherited; refusal over code or dividers; stale guard.
- Schemas and request validation: lengths, strictness, unknown keys; prompts carry version ids and the data rule.

### Integration (real routes and database, mock provider)

- Each route: 401 without sign-in; `AI_DISABLED` when off; 400 on invalid bodies (prompt over 2,000, selection over 6,000, unknown keys); rate limit with `retryAfterSeconds`; usage row with no text.
- **Generate:** context is read by id and owner (another person's note or task id gives 404; the client's own text is never used); `target: "new"` reads nothing; `useContext: false` sends none; title event appears only when asked.
- **Plan:** only the caller's candidates are sent; proposals for unknown or duplicate ids are dropped; none of the other person's tasks ever appear; no candidates means no model call and no usage row; a malformed line does not break the stream.
- **Edit:** never reads the workspace; Continue requires `before`; the others reject it.
- Applying a plan with the existing actions: due dates set, Focus set, another person's task id rejected, Undo restores.

### End to end (mock provider only)

1. Notes page → **Write with AI** → prompt, Standard, title on → the preview streams formatted (heading, list, checklist, quote, code visible as in the editor) → **Create note** → the note exists with the title and exactly that structure; no note exists before the click.
2. Open note → menu **Generate with AI** with context on → insert **at the end**; reload shows it saved; `⌘Z` removes it.
3. **Replace everything** needs its second step; Undo toast restores the note.
4. ⌘K → "Write a note with AI" opens the panel on `/notes/new`; leaving without creating leaves no note.
5. Task description → **Generate with AI** → Add to end → description shows formatted content and is saved.
6. Short, Standard and Detailed produce increasing amounts of content.
7. **Plan my day**: with overdue, due-today and high-priority tasks, proposals stream in order, the unknown-id line is ignored, untick one, change the Focus, **Plan N tasks** → due dates and Focus saved; **Undo** restores them; with a clear day the dialog says so and no usage row is recorded.
8. **Writing help**: select a sentence in a bold list item → **Improve** → Before/After → **Replace** → the list item and bold survive; `⌘Z` restores the original; **Discard** changes nothing; editing the range during preview disables Replace; Continue inserts below.
9. Each feature with `[mock:error]` shows Failed with Retry and leaves the document untouched; a rate-limited user sees "Try again in N seconds."
10. With AI off: none of the entries exist (notes page, new note, note menu, ⌘K, task description, Today, selection menu) and direct POSTs return `AI_DISABLED`.
11. Stop mid-stream: the preview stops, **Replace/Insert** still apply what was written (labelled "Stopped"), and the usage row is `SUCCESS`.
12. Isolation: generate/plan as person A never include person B's content.
13. Accessibility (axe) on the panel, the plan dialog and the edit panel in light and dark; reduced-motion check (no transform) for streaming rows and panel growth; phone width (360px): no sideways scroll, ≥ 44px targets.

Existing E2E accessible names must not change (feature 07 rule). CI makes zero paid calls.

---

## 12. Build order

Each step leaves the app working and all tests passing.

| Step | Content |
|---|---|
| M1 | Foundation (§4): migration `0006`, `AIFeature` additions, `maxOutputTokens`, abort handling, `StreamEvent` additions and generalised stream hook, `markdownToDoc` + tests, `splitTitle`, `DocPreview`, editor handle, apply helpers, mock fixtures |
| M2 | **A** route, panel, entries (Notes page, new note, note menu, ⌘K, task description), apply paths, tests |
| M3 | **C** route, selection menu button, edit panel, replacement algorithm, tests |
| M4 | **B** candidate loader, route, JSON Lines parser, dialog, apply and Undo, tests |
| M5 | Settings notice, docs, a11y/reduced-motion/responsive passes, as-built section |

---

## 13. Rules, risks and limits

- **Quota.** Each generation, regeneration, edit and plan is one action against 10/min and 100/day. Detailed generation and Regenerate use the most; the panel shows no counters (Settings → AI has the usage line). Do not raise defaults to hide this.
- **Free-tier models** can stop early or ignore formatting rules. That is why output is converted defensively, JSON Lines are line-validated, and any failure leaves everything unchanged.
- **Long output** needs the stream timeout (60s) and a token cap per length; a Detailed note that is cut off is shown as "Stopped" and can still be inserted, regenerated or discarded.
- **Prompt injection.** Notes and tasks may contain instructions. They are always inside `<data>` blocks and the system prompt says to treat them as material. Output is only ever text, a validated document, or ids we sent, so an injected instruction cannot call a tool or write anything.
- **Document size.** Generated content passes the same 200,000-byte, depth-20 rules as typed content.
- **Privacy.** Generate sends the prompt and (optionally) the current note or task; Plan sends task titles; Edit sends the selected text. All stated in Settings (§9.6). Nothing is stored beyond usage rows.
- **Concurrency.** Applying content to a note uses the editor and `useNoteSync`'s version check; a conflict shows the existing banner.

---

## 14. Out of scope

- Time-boxing, estimates or scheduling times (needs an estimate field or the V2 calendar); persisting the plan's order.
- Auto-running any of these, background drafting, or saved prompts and history.
- Multi-turn chat or "refine this draft" conversations (Regenerate and Edit prompt are the only loops).
- Tables, images or embeds in generated content; Markdown import/export of notes.
- Writing help in task descriptions or titles; rewriting a whole note in one click.
- Per-user model choice; new AI providers; embeddings.
- Collaboration or sharing of generated content.

---

## 15. Definition of done

- [ ] A, B and C work end to end with the mock provider and a real provider; all three **stream**
- [ ] Generated text is shown formatted like the editor while it arrives, and the applied result passes `sanitizeDoc` and is identical to what the preview showed
- [ ] Generate: new note, insert at cursor, at the end, replace everything (with undo), and task description all work; title is optional and editable; context from the current note or task works and is owner-scoped
- [ ] All five Generate entry points exist and hide when AI is off
- [ ] Plan my day sets due dates and the Focus only on confirm, can be undone, and never includes another person's tasks; empty days make no model call
- [ ] Writing help replaces the selection in one undo step, keeps block structure and first-character marks, refuses unsafe selections, and detects stale text
- [ ] No AI path writes before an explicit click; Stop and Failed leave data untouched
- [ ] Limits, usage rows (`SUCCESS` on cancel), and the Settings notice are correct
- [ ] Unit, integration and end-to-end tests above pass; axe, reduced-motion and 360px checks pass in light and dark
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` and `theme:check` pass; CI makes zero paid AI calls
- [ ] `agent_docs/ai-writing-and-planning_v1.md` written, with the index line in `agent_docs/README.md`; earlier hand-offs updated where they say AI actions are limited to feature 05's list
- [ ] An "as built" section is added to this document with every deviation

---

## 16. As built (2026-10-03)

All three features are built and pass their tests with the mock provider. Differences from the text above:

- **Placement default** in the Generate panel is "At the end", not the cursor. The menu on the primary button offers cursor, end and replace; the button's label follows the choice ("Insert at cursor", "Insert at end", "Replace note"). For a task: "Add to end" and "Replace description".
- **Plan lines are checked by hand**, not with a Zod schema: `parsePlanLine` in `src/lib/ai/plan.ts` reads one line (JSON, an object, a summary or a UUID-shaped `taskId`) and `PlanCollector` keeps ids we sent, once each, at most five. The planned `parsePlanLines` function is `PlanCollector.push` / `end`. `src/lib/ai/schemas.ts` was not changed.
- **Empty plan** is a stream that ends with no events but `done`; the dialog reads "done with no proposals" as a clear day. A stream that ends with no valid proposals after the model ran is an `error` event, as specified.
- **Token caps:** only the three new features set `maxOutputTokens` (600 / 1,500 / 4,000 for Generate; about twice the input, at most 2,000, for Writing help). Existing features keep the provider's own default; no 1,200 default was added.
- **Hook:** `useAIEvents(path, initial, reduce)` in `components/ai/use-ai.ts` was added instead of changing `useAIStream`, which Summarize and Ask still use. It adds a `stopped` state that keeps what arrived.
- **`useAutosave().flush`** now returns a promise, so the panel can wait for a pending save before the server reads the saved text.
- **Keyboard:** `⌘/Ctrl+Shift+J` opens the Writing help menu in the formatting toolbar for the current selection. The app has no shortcuts list to document it in.
- **Writing help panel:** a Radix popover anchored under the selection (a virtual anchor from the selection's coordinates) from 768px, a bottom sheet below. The popover closes on any outside click, which also discards.
- **Replacement** (`replaceSelection` in `ai-apply.ts`): equal block counts replace block by block; otherwise the range is replaced with an open slice of paragraphs, so the first block keeps its type and the text around the range is joined on. Marks are those of the first character; links are kept only when their exact words survive (`placeLinks`).
- **Stale guard:** a range tracker follows the selection through later transactions and marks it stale when anything inside it changes; Replace also re-reads the range text. There is no E2E for it (see above); the pure comparison is unit-tested.
- **Mock:** the plan fixture carries task titles, so `[mock:error]` in a title fails the plan.
- **Tests that select text** use click, End, Shift+Home. Repeated triple clicks were unreliable in the browser and are not a product problem.
- **Not done:** visual baselines for the new panels; Docker/CI (not available here); a real-provider run (Gemini free tier was not called).

