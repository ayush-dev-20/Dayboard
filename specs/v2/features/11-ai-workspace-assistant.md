# Feature 11 — AI Workspace Assistant

## 1. Scope

- A **multi-turn assistant** scoped to the signed-in person's workspace, in a dedicated page and from ⌘K
- **Tools as application commands**: search the workspace (hybrid, from 10), read an item, summarise, extract action items, find related items, explain a retrieval
- **Proposals, never silent changes**: task creation and edits are shown as editable proposals and applied only on an explicit confirm
- **Citations** as clickable references to the underlying notes and tasks, verified server-side
- **Related notes and tasks** panels on notes and task details
- **Audit records** for every AI-triggered mutation
- Degrades gracefully: the workspace stays fully useful when the provider is down
- **A floating chat launcher** (a fixed button at the bottom right of every screen) that opens the same assistant in a compact panel and answers from the person's own data; a **note, task or project can be dragged onto it** to ask questions about that one item (§6A)
- **Ask AI** and **Update with AI** on selected text in the editor, next to the existing Improve writing actions: ask a question about the selection, or rewrite it with the person's own instruction (§6B)

Reuses: V1 AI pipeline (`src/lib/ai/gate.ts`, `usage.ts`, `prompts.ts`, `index.ts`, mock provider, NDJSON streaming helper), V1 Ask retrieval and citation filtering (`context.ts`, `answer.ts`), `searchWorkspace` and `reasons` from feature 10, V1 confirm patterns (`TasksPreviewDialog`, overdue cleanup), `createTasksBatch` and task actions/commands, feature 04/05 commands so confirmed changes work offline-capable where they can; for §6B the V1 Writing help pieces (`/api/ai/edit-selection`, `src/components/editor/ai-selection-menu.tsx`, `ai-edit-panel.tsx`, `ai-apply.ts`, `src/lib/editor/replace-plan.ts`, V1 feature 08 §7); for §6A the drag-and-drop library of ADR 0008 and the command menu's search picker.

Source spec sections: product §7, §13, §2.1 row 5; technical §6, §7, §13; V2 `Agent.md` §5; V1 AI feature doc for pipeline and states.

---

## 2. What changes from V1 Ask

V1 "Ask your workspace" (⌘K, Ask tab) answers one question at a time from lexical retrieval, read-only. V2 keeps that quick path and adds an assistant that **remembers the conversation**, **uses semantic retrieval**, **uses tools**, **proposes changes** and **explains why** an item was retrieved. The ⌘K Ask tab gets an **Open in assistant** action that continues the same thread.

Two more ways in, both added on the owner's request (2026-10-09): a **floating chat launcher** on every screen, where an item can be **dropped on it** to ask about that item (§6A), and **Ask AI / Update with AI** on selected text, which extends V1's Writing help (§6B). The launcher is the same assistant as the page, not a second one; §6B is a separate, lighter path that works on the selected text only.

---

## 3. Data model

### `audit_log` (new)

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `source` | `ASSISTANT`, later `WEEKLY_REVIEW`, `VOICE` |
| `action` | e.g. `tasks.create`, `task.update`, `task.reschedule` |
| `entity_refs` | jsonb: `[{ type, id }]` of items changed |
| `proposal_id` | text: ties the change to the proposal the person confirmed |
| `summary` | short text ≤ 200 chars (counts and kinds, e.g. "Created 3 tasks"), **never note content or prompts** |
| `created_at` | |

Index `(user_id, created_at DESC)`. Written when a confirmed AI proposal is applied (technical spec §13).

### Threads: on the device, not on the server

Conversations (messages, retrieved source cards, proposals) are kept **locally** in Dexie (`assistantThreads`, `assistantMessages`), per user, so Dayboard's servers store no prompts or answers (consistent with V1 and §13 "do not log full private notes"). Consequences, stated in the UI: a thread does not follow the person to another device; "Clear conversations" deletes them locally; sign-out clears them (feature 04's wipe). On each turn the **client sends the recent history** (last 10 messages, trimmed) with the request.

### `ai_usage`

New feature values `ASSISTANT` (one action per turn) and `RELATED` (none: related items use the index and cost no model call). Prompt version `ASSISTANT_V1`.

§6B adds `ASK_SELECTION` (one action per question about selected text; prompt version `ASK_SELECTION_V1`). "Update with AI" is recorded as the existing `EDIT_SELECTION` with a new `CUSTOM` mode and prompt version `EDIT_SELECTION_V2` (V1's four modes are unchanged). Both are `ALTER TYPE ... ADD VALUE` (expand-only). §6A adds one boolean to `user_preferences`, `assistant_launcher` (default `true`, expand-only), for the "Show the chat button" setting.

---

## 4. Request pipeline

`POST /api/ai/assistant` (Route Handler, streaming NDJSON, same gate as V1): `requireUser()` → AI enabled → Zod → `checkLimits` (one action per turn, per-minute and per-day as V1) → run the tool loop → stream → record `ai_usage`.

**Request:** `{ messages: [{ role: "user" | "assistant", text, sourceIds? }], context?: { type: "note" | "task" | "project", id } }` (≤ 10 messages, each ≤ 4,000 chars; `context` lets "Ask about this note" start scoped; the server loads it **by id and owner**, never from client text).

**Several items (§6A):** the request may carry `contexts: [{ type: "note" | "task" | "project", id }]` (at most 5; the single `context` form stays valid and means a list of one). Every id is re-checked against the signed-in person before anything is read; an id that is not theirs (or is in Trash) is refused with the same `NOT_FOUND` as an id that does not exist, and the turn does not run. A project context stands for the project **and its tasks and notes** (titles and a capped excerpt of each, newest first, within the same 6,000-character-per-item and overall retrieved-content budgets). While `contexts` is present the server **limits `searchWorkspace`, `getItem`, `listTasks` and `findRelated` to those items** (and a project's members): the assistant answers from what was dropped, says when that is not enough, and never quietly widens the scope. The person widens it by removing the chips (§6A).

**Tool loop (server, bounded):** the model may call up to **5 tool steps** per turn. Each tool is an application command with a Zod input schema and an owner-scoped implementation; there is **no arbitrary database access**.

| Tool | Does | Mutates? |
|---|---|---|
| `searchWorkspace` | hybrid search (10) with optional filters; returns up to 8 results with ids, titles, snippets, reasons | no |
| `getItem` | reads one note, task or project (owner-checked), content capped at 6,000 chars | no |
| `listTasks` | open, overdue, due-today tasks by simple filters (project, status, due range) | no |
| `summarizeItems` | asks for a summary of already retrieved items (no new data) | no |
| `extractActionItems` | returns candidate tasks from a retrieved note | no (output is a proposal) |
| `findRelated` | nearest items to an item from the index (10) | no |
| `proposeTaskChanges` | records a **proposal**: create tasks, update fields, reschedule, or link a note | **no: it returns a proposal object only** |

Mutating tools do not exist. `proposeTaskChanges` validates the proposed payload (Zod, ids must belong to the user) and emits a `proposal` event. Nothing is written until the person confirms in the UI (§6).

**Grounding.** The model receives only the minimum retrieved content, wrapped in labelled `<data>` blocks (S1…S12) with the V1 injection rule: content is material, never instructions. Each retrieved item carries `{ id, type, title, link, relevance, reasons }` (technical §7). The answer's citations are labels; the server **keeps only labels that were really provided** (V1 `filterCitations`) and checks quoted text against the provided source text (V1 `verifyQuotes`).

**Explaining retrieval.** "Why this result?" is answered from the **retrieval reasons recorded by the server** (matched terms, best passage, semantic closeness), shown as facts in the UI. The model may phrase them but cannot invent a reason: the explanation block is rendered from metadata, not from model text.

**Events (NDJSON):** `text` (delta), `tool` (`{ name, status }` for a quiet "Searching your workspace…" line), `sources` (verified source cards), `proposal` (structured), `error`, `done`. Failure after the stream starts becomes an `error` event; provider errors never lose the thread.

**Provider interface:** the adapter gains tool-use support inside `src/lib/ai/providers/sdk.ts` (the AI SDK's tool calling), exposed as `runAssistantTurn(input, tools, signal)` returning an async iterable of the events above. The mock provider executes **scripted tool calls** from fixtures so CI is deterministic and free.

**Prompt rules** (`ASSISTANT_V1`): answer only from retrieved content, say when nothing relevant was found (the V1 "I couldn't find anything" behaviour), cite with labels, never claim an action was done, propose changes only through `proposeTaskChanges`, keep answers short, reply in the user's language, no sparkle language.

---

## 5. Proposals and confirmation

Proposal types:

```ts
type Proposal =
  | { id; kind: "createTasks"; items: { title; dueDate?; priority?; projectId?; linkNoteId? }[] }
  | { id; kind: "updateTasks"; changes: { taskId; set: { status?; priority?; dueDate?; projectId? } }[] }
  | { id; kind: "linkNotes"; links: { taskId; noteId }[] };
```

- Shown as a **ProposalCard** in the thread: a checklist where each row is editable and can be unticked (the V1 preview pattern). Updates show **before → after**.
- **Confirm** applies the ticked rows through the **existing commands** (feature 04/05: `createTasksBatch`, `task.update`, `taskNote.link`), so results match everything else and work offline. Then it writes one `audit_log` row (source `ASSISTANT`, the proposal id, entity refs, a short summary).
- Cancelling or ignoring a proposal changes nothing. A proposal expires with its thread and cannot be applied twice (a confirmed proposal is marked applied locally and its id is recorded in the audit row).
- **No silent mutation** anywhere: no tool writes, no streaming step writes, no background job acts on assistant output.

---

## 6. UI

- **Assistant page** `/assistant` (sidebar item under Library or Plan: "Assistant", no sparkle icon). A calm conversation: the person's messages as plain text, answers in the tinted AI panel with the "AI-generated" label and a caret while streaming (V1 `GrowingAiPanel` and `StreamCaret`), source chips under each answer (note and task titles with type, clickable), a quiet "Searched your workspace" line, proposal cards, Stop, Retry, and a composer (multi-line, Enter to send, Shift+Enter newline, 4,000 char limit with counter near the end).
- **Starter prompts** (three, plain text): "What did I write about …?", "What's overdue in <project>?", "Turn this note into tasks" (when opened from a note).
- **Entry points:** sidebar item; ⌘K Ask tab → **Open in assistant**; note and task overflow menus → **Ask about this** (starts scoped, the context chip is visible and removable); the Today brief unchanged.
- **Thread list:** a slim side list of local threads (title from the first question), rename, delete, **Clear all conversations**. "Stored on this device only."
- **Explain:** every source chip has a **Why** disclosure showing the recorded reasons.
- **Related panel:** on notes and task details, a collapsed **Related** section lists up to 5 related notes and tasks (nearest to the item, excluding itself and already linked items), each with a one-line reason ("Mentions login failures"), clickable, with **Link to this task/note** where a link makes sense (confirm-free: it is an ordinary link action the person chose). Computed from the index without a model call; hidden when semantic search is off; cached for 10 minutes.
- **States:** the V1 four (Ready / Generating / Complete / Failed + Retry); rate limited shows the amber note with the wait; AI off or no key shows nothing (all assistant surfaces hidden, as V1); semantic off shows the answer from keyword retrieval with a one-line note; **offline** shows "The assistant needs a connection. Search still works." and a link to search.
- **Accessibility:** the thread is a log region announced politely when an answer completes (not per chunk), composer labelled, proposal rows are checkboxes with names, 44px targets; reduced motion keeps the caret static.

---

## 6A. Floating chat launcher

A quick way to talk to the assistant from anywhere, and to point it at one thing by dropping it on the button.

**The button**
- A round **48px** button fixed to the **bottom right** of every signed-in screen, drawn with a speech-bubble icon (Lucide `MessageCircle`). **No sparkle, no badge, no gradient, no mascot** (see "Design rules this changes"). Accessible name "Ask your workspace", tooltip with the shortcut, `aria-expanded` and `aria-controls`. The shortcut is chosen when building so it clashes with none that exist (the UI/UX spec lists them) and is shown in the tooltip and in Settings.
- Placed against the **main content area, not the window**, 16px from its right and bottom edges (plus the device's safe-area inset), so it never sits over the task detail side panel. On a phone it sits **above the bottom navigation** (never over it, never a bottom-nav tab: the V2 UI/UX spec §2 stands) and moves up by the height of any bottom bar on the page (the bulk-actions bar of the Table and Board views, the editor's mobile toolbar).
- Hidden when AI is off or has no key (as every AI surface is), on `/assistant` (it would only repeat the page), in print, and while a modal dialog or sheet is open (it sits below dialogs in the layer order). **Settings → AI → "Show the chat button"** (on by default) hides it for the person; the page, ⌘K and the item menus still work.

**The panel**
- Opens from the button, its shortcut or Enter on it. On a desktop it is a **compact floating panel anchored bottom right** (about 400px wide and up to 600px tall, the popover/dialog surface of DESIGN.md). Under 768px it is a **bottom sheet** that fills 90% of the height. It **overlays** the page: it is not a docked sidebar, never resizes or pushes the content, and the page behind stays usable.
- It is **the same assistant as the page** (§4 to §5): the same tools, citations with a **Why** disclosure, proposal cards with Confirm, Stop and Retry, and the same local threads. Header: the thread title with a menu (New chat, switch thread), **Open full page** (continues the same thread on `/assistant`) and Close. With nothing dropped it answers from the **whole workspace**.
- Closes with Esc (when focus is in the panel), its Close button or the launcher. **It does not close when the person clicks elsewhere**, so they can keep it open and drag items onto it. Whether it is open is not remembered between page loads.
- Empty state: the three starter prompts of §6 (adapted to the context chips, below).

**Dropping an item to ask about it**
- **Draggable items:** a note, task or project wherever it appears as a row, card or tile: the Notes and Tasks lists and the Table, Board and Gallery views, project cards and sidebar project rows, the sidebar notes tree, Today, search and ⌘K results, and the Related panels. Each carries only `{ type, id, title }`; the server re-checks ownership (§4).
- **While one is dragged**, the button grows into a labelled **drop zone** ("Drop to ask about this", accent outline, announced to screen readers); if the panel is open the area above its composer becomes the drop zone. Hovering over the button for about half a second opens the panel. Dropping adds a **context chip** (type icon and title, with a remove button) above the composer. **Nothing is sent by the drop**: the person types the question. The composer placeholder becomes "Ask about “Title”…", and the starter prompts adapt: "Summarize this", "What's open here?" (a task or project), "Turn this into tasks" (a note).
- **Up to 5 chips.** A sixth is refused with a short message; dropping the same item twice does nothing. Chips belong to the **thread** and are stored with it locally, shown in the thread header ("Answering from: …"), and can be removed or added between turns. While chips are present the assistant answers **only from them** (§4, "Several items"); a **Search everything instead** action removes them.
- **Keyboard and touch alternatives** (required by the V2 feature README for every drag-and-drop action): every note, task and project overflow menu gets **Ask about this** (opens the panel with that chip); the panel has **Add item…** beside the composer, a searchable picker of notes, tasks and projects (the command menu's search, reused); and on a note, task or project page the empty panel offers a one-click chip "Ask about this note" (or task, or project) for the page the person is on, never added by itself.
- **Drag mechanics are an ADR (0015)**: either the native browser drag with a custom data type, or the existing dnd-kit droppable (ADR 0008), whichever does not break the drags that already exist (Board card moves, sidebar tree nesting and reordering, which use pointer sensors with an activation distance). A row that is already a drag source for reordering still reorders; dragging an item *out of a list* onto the launcher never changes the list.

**States and accessibility**
- The states of §6 apply (Ready, Generating, Complete, Failed with Retry; rate limited shows the amber note with the wait; offline shows "The assistant needs a connection. Search still works." and dropping chips still works so a question can be sent when the connection returns).
- The panel is a **non-modal `role="dialog"`** named "Assistant". Focus moves to the composer on open and returns to the launcher on close. A drop announces "Added to the chat: Title" in a polite live region; chips are a list with remove buttons named "Remove Title from the chat"; the conversation is the log region of §6. Touch targets are at least 44px. With reduced motion the panel and the drop zone appear without sliding or scaling.

**Design rules this changes.** V1's UI/UX spec §AI and DESIGN.md say **"no chat sidebar or chat page"**. Feature 11 already adds a page (`/assistant`), and this adds a floating panel. What stays: the panel is a floating layer, not a sidebar; no sparkle glyph, AI badge or gradient; AI text still sits in the tinted panel labelled "AI-generated"; nothing is written before a click. Before building, ADR 0015 records the change and the owner amends that sentence in DESIGN.md and the V1 UI/UX spec (they are read-only for feature work until the owner asks), and a design for the launcher, panel and drop zone is added to `designs/v2/` (no design exists yet).

## 6B. Ask AI and Update with AI on selected text

Today (V1 feature 08) selecting text in a note offers **Improve writing**: Improve, Shorten, Fix grammar (and Continue from the toolbar), each a one-click rewrite with a before/after preview. This adds two open-ended actions next to them.

**Where**
- In the **floating selection menu** (the "Improve writing" menu that appears over selected text) and in the toolbar's **Writing help** menu. After the three one-click actions and a divider the menu lists **Ask AI…** and **Update with AI…**. Choosing either turns the same popover (a bottom sheet under 768px) into a small panel; Esc goes back without changing anything.
- In **notes** (where Writing help already lives) and, new in this feature, in **task descriptions**, which gain the same selection menu. Hidden when AI is off, offline-disabled with the note "Needs a connection".

**The small panel**
- Shows the selection as a quoted line ("Selected: …", cut to two lines) and one text box: "Ask about this text" or "How should it change?" (multi-line, 500 characters, Enter sends, Shift+Enter a new line). Three plain-text quick phrases that only fill the box: for Ask, "Explain this", "Summarize", "What is missing?"; for Update, "More formal", "Simpler", "Add detail".

**Ask AI** (a question about the selection)
- The answer streams into the tinted AI panel labelled "AI-generated", read-only, with **Copy**, **Insert below** (a plain paragraph after the selected block, one undo step, written only on that click), **Ask another** and **Continue in assistant** (opens the chat panel with the selection as a text chip "Selected text from <title>", so it can become a conversation with tools; the selection itself is carried by the client, since it is the person's own text).
- It answers from the selection and the **text around it** in the same note or task (loaded by id and owner, up to 6,000 characters around the selection); it has **no tools** and does not search the workspace (that is the assistant). It says plainly when the text does not contain the answer. Answers are not cited (the source is the selection, shown as "From your selection").

**Update with AI** (rewrite the selection with the person's own instruction)
- The model returns **only the replacement for the selection**. The **same before/after panel as Writing help** shows it arriving: **Replace** (default), **Insert below**, **Regenerate**, **Edit instruction** (back to the box, keeping the text) and **Discard**; **Stop** while streaming. Replacing is **one undo step**, keeps block structure and the first character's marks (`replace-plan.ts`, `ai-apply.ts`), and nothing is written before the click. A failure or Stop leaves the document exactly as it was; the "text changed" guard of Writing help applies (if the selected text changed meanwhile, Replace is refused with a message).
- The instruction changes **only the selection**: it cannot make the model edit anywhere else, and the selection is treated as data, never as instructions (the V1 injection rule). The instruction is the person's own words and is passed as the task.

**Server**
- **Update** extends `POST /api/ai/edit-selection` with `mode: "CUSTOM"` and `instruction` (1 to 500 characters, trimmed); prompt `EDIT_SELECTION_V2`. **Ask** is a new streaming route `POST /api/ai/ask-selection` with `{ ownerType: "note" | "task", ownerId, selection, question }`; prompt `ASK_SELECTION_V1`. Both go through the gate (sign in, AI on, strict Zod, one action each against the V1 limits), cap the selection at the Writing help limit, never write, and record one `ai_usage` row with no text (`ASK_SELECTION`, and `EDIT_SELECTION` for Update). The mock provider returns fixtures keyed by the V1 markers (`[mock:error]`, `[mock:slow]`) so CI is deterministic.
- Settings → AI's data notice gains one line: Ask and Update send the selection and the text around it.

## 7. Limits and safety

- One AI action per turn against the V1 limits (10/min, 100/day); at most 5 tool steps; retrieved content capped (12 sources, 20,000 chars total, V1 budgets); history 10 messages.
- All retrieval and tools run server-side with the session user; ids from the model are re-checked against ownership before anything is read or proposed.
- **Prompt injection:** note and task text is untrusted data. Nothing in retrieved text can cause a tool call to write (no writing tools exist) or to widen scope (tools take only the user's own data). Proposals contain ids and strings that are validated and shown for review.
- Logs and `ai_usage` carry no prompts, answers, notes or tool payloads.
- AI failure never blocks the page; the assistant simply reports the failure and offers Retry.
- **Dropped items and selections:** an item id from a drop is untrusted client input and is checked for ownership like any other id (§4); a text selection is untrusted data, never instructions; at most 5 items per chat; the selection is capped at the Writing help limit. "Update with AI" writes nothing until Replace is clicked, and the chat panel's proposals still need Confirm.

---

## 8. Tests

**Unit**
- Tool input schemas; proposal schemas; label filtering of citations; quote verification; history trimming; prompt carries the version and the data rule.
- `proposeTaskChanges` rejects ids that are not the user's (given a fake data layer) and malformed payloads.
- Scripted mock turns: tool sequence, step cap, error mid-stream.
- **§6A:** the `contexts` schema (max 5, valid types, no duplicates); scope limiting (given items, `searchWorkspace` and the other tools only ever see those items and a project's members); the chip-add rules (a sixth refused, a repeat ignored); the drag payload is only `{ type, id, title }`.
- **§6B:** the `CUSTOM` mode and `instruction` schema (length, trimming, no instruction for the other modes); `ask-selection` request schema; the prompts carry their versions and the data rule; selection and surrounding-text caps; the "text changed" guard for Update.

**Integration** (real routes and database, mock provider)
- **Scope:** every tool returns only the caller's data; a forged id from "the model" for another person's note is `NOT_FOUND` and never leaks; context ids are owner-checked.
- **No mutation:** a full assistant turn that proposes tasks changes no task rows; confirming through the commands creates exactly the ticked rows and one `audit_log` row without content.
- Rate limit with `retryAfterSeconds`; `AI_DISABLED`; usage row without text; failure path leaves no partial writes; step cap enforced.
- Citations: only provided labels survive; fabricated quotes are not shown as workspace quotes.
- Retrieval reasons in the response equal the search reasons (not model text).
- **§6A scope:** a turn with `contexts` never reads, cites or proposes anything outside those items (a note that links to another person's id, or a project holding a note in Trash, leaks nothing); a context id that is another person's, trashed or missing gives the same `NOT_FOUND`; more than 5 items is a validation error.
- **§6B:** `ask-selection` and `edit-selection` (`CUSTOM`) require sign-in and AI on, read the surrounding text only by id and owner (another person's note id is `NOT_FOUND`), write nothing, record one usage row without text, honour the per-minute and per-day limits with `retryAfterSeconds`, and fail without partial writes.

**E2E** (mock provider)
1. Ask a question → streamed answer with source links → click a source opens it.
2. "Why" shows recorded reasons.
3. Follow-up question uses the thread context.
4. Ask about a note → proposals (create tasks) → untick one, edit a title → Confirm → exactly those tasks exist; one audit entry; Cancel changes nothing.
5. Related panel on a note lists neighbours; link action works.
6. Provider failure shows Retry and leaves the workspace unchanged; rate limit note; AI off hides everything; offline message.
7. Threads are local: sign out clears them; nothing is stored server-side (check `ai_usage` columns).
8. Axe, 360px, light and dark, reduced motion.
9. **Launcher:** the button shows bottom right on app screens and not on `/assistant` or with AI off; it opens the panel, Esc closes it, clicking the page does not; the thread continues on `/assistant`; on a 360px screen it sits above the bottom nav; Settings → AI can hide it.
10. **Drop to ask:** drag a note from the list onto the button, a chip appears, nothing is sent, the question is answered from that note only (and a cited link opens it); the same for a task and a project; a sixth item is refused; the chip's remove button and "Search everything instead" widen the scope; the **Ask about this** menu item and **Add item…** do the same without dragging; a Board card or a tree row dragged onto the launcher is not moved.
11. **Ask AI on a selection:** select a sentence, Improve writing → Ask AI…, ask, see the streamed answer, Insert below adds it as one undo step, Continue in assistant opens the chat with the selection chip; the document is unchanged until Insert.
12. **Update with AI on a selection:** instruction → before/after → Regenerate, Edit instruction, Replace (one undo restores it), Discard changes nothing; a failure leaves the text as it was; works in a task description too; hidden with AI off.

---

## 9. Definition of done

- [x] The assistant answers questions from the person's own notes and tasks, cites them with working links, and can explain why each result was retrieved
- [x] It can propose task creation, edits and links; nothing is written until the person confirms; confirmed changes are audited without content
- [x] Every tool is owner-scoped and tested against cross-user attempts and prompt injection
- [x] Threads live on the device only; nothing private is stored or logged by the server
- [ ] The workspace stays useful when the provider is unavailable, the feature is off, or the device is offline _(provider failure and feature off are done and tested; the offline message waits for the offline features 03 to 05)_
- [x] Related notes and tasks show on notes and task details without a model call
- [x] The adapter and mock support tool use; CI makes no paid calls
- [x] **Launcher (§6A):** the floating button opens the same assistant in a compact panel on every app screen; a note, task or project dropped on it (or added by "Ask about this" or "Add item…") scopes the answers to that item, enforced on the server and tested against other people's ids; it works by keyboard and touch; it never covers the bottom nav or the task panel; Settings → AI can hide it
- [x] **Selection (§6B):** Ask AI and Update with AI work on selected text in notes and task descriptions; Update writes only after Replace, as one undo step; both are limited, logged without text and tested with the mock provider
- [x] ADR 0015 written, and DESIGN.md and the V1 UI/UX spec amended by the owner for the floating chat panel
- [x] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass
- [x] `agent_docs/ai-assistant_v1.md` updated, and `agent_docs/ai-workspace-assistant_v2.md` written and indexed

### As built (2026-10-09)

Built before feature 10 (semantic search) and without Dexie (features 03 to 05). What differs from the text above:

- **Retrieval is keyword-based.** `searchWorkspace` and Related use the V1 lexical search (`searchItems`, `findRelatedItems` in `src/db/queries/assistant.ts`). "Why" shows the shared words, not closeness of meaning. Feature 10 replaces those two functions and keeps their return shape.
- **Threads are in `localStorage`** (ADR 0016), not Dexie: 30 threads, 100 messages each, wiped on sign-out.
- **Five tools, not eight:** `searchWorkspace`, `getItem`, `listTasks`, `findRelated`, `proposeTaskChanges`. Summaries and action items come from the model reading `getItem`. `proposeTaskChanges` returns a proposal and never writes.
- **Stream events** are `tool` and `assistant-proposal` (`proposal` was already used by plan-day).
- **Apply:** `createTasks` is one transaction. `updateTasks` and `linkNotes` apply row by row, so a failing row is reported and the others stay applied. Each proposal id can be applied once per person.
- **Related** needs AI turned on in Settings and only counts shared words.
- **Offline:** not built (needs features 04 and 05). Confirming a suggestion needs a connection.
- **No mockup** in `designs/v2/` for the button, panel or drop zone; they follow DESIGN.md.
- **Not verified:** the real provider (the SDK tool loop is tested only with the SDK's mock model), touch devices, Safari and Firefox.
- Gate on 2026-10-10: lint, typecheck, 1332 unit, 304 integration, build, `check:bundle`, `theme:check`, DESIGN.md lint pass. E2E: full run 386 passed and 13 failed; 12 of those passed when re-run alone (the machine was under load), one was real (the launcher's always-present live region had `role="status"` and broke a page-wide status query; fixed) and 4 empty-state screenshots were refreshed for the new sidebar item and button. Handoff: `agent_docs/ai-workspace-assistant_v2.md`.

---

## 10. Out of scope (V2)

Server-stored conversations or sharing; tools that write directly; autonomous agents or background actions from chat; voice conversation; web browsing tools; image understanding; long-term "memory" beyond the thread; assistants for team workspaces; calendar tools (added by 12 for planning, see its doc). For §6A and §6B: a launcher the person can move or resize; dragging items out of the chat; a docked or always-open chat sidebar; dropping files, images, attachments or text snippets on the launcher (only notes, tasks and projects); several back-and-forth turns inside the selection popover (Continue in assistant is the way to a conversation); Update with AI changing more than the selection, or rewriting tables and images; voice input to the launcher.
