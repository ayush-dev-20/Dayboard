# Feature 11 — AI Workspace Assistant

## 1. Scope

- A **multi-turn assistant** scoped to the signed-in person's workspace, in a dedicated page and from ⌘K
- **Tools as application commands**: search the workspace (hybrid, from 10), read an item, summarise, extract action items, find related items, explain a retrieval
- **Proposals, never silent changes**: task creation and edits are shown as editable proposals and applied only on an explicit confirm
- **Citations** as clickable references to the underlying notes and tasks, verified server-side
- **Related notes and tasks** panels on notes and task details
- **Audit records** for every AI-triggered mutation
- Degrades gracefully: the workspace stays fully useful when the provider is down

Reuses: V1 AI pipeline (`src/lib/ai/gate.ts`, `usage.ts`, `prompts.ts`, `index.ts`, mock provider, NDJSON streaming helper), V1 Ask retrieval and citation filtering (`context.ts`, `answer.ts`), `searchWorkspace` and `reasons` from feature 10, V1 confirm patterns (`TasksPreviewDialog`, overdue cleanup), `createTasksBatch` and task actions/commands, feature 04/05 commands so confirmed changes work offline-capable where they can.

Source spec sections: product §7, §13, §2.1 row 5; technical §6, §7, §13; V2 `Agent.md` §5; V1 AI feature doc for pipeline and states.

---

## 2. What changes from V1 Ask

V1 "Ask your workspace" (⌘K, Ask tab) answers one question at a time from lexical retrieval, read-only. V2 keeps that quick path and adds an assistant that **remembers the conversation**, **uses semantic retrieval**, **uses tools**, **proposes changes** and **explains why** an item was retrieved. The ⌘K Ask tab gets an **Open in assistant** action that continues the same thread.

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

---

## 4. Request pipeline

`POST /api/ai/assistant` (Route Handler, streaming NDJSON, same gate as V1): `requireUser()` → AI enabled → Zod → `checkLimits` (one action per turn, per-minute and per-day as V1) → run the tool loop → stream → record `ai_usage`.

**Request:** `{ messages: [{ role: "user" | "assistant", text, sourceIds? }], context?: { type: "note" | "task" | "project", id } }` (≤ 10 messages, each ≤ 4,000 chars; `context` lets "Ask about this note" start scoped; the server loads it **by id and owner**, never from client text).

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

## 7. Limits and safety

- One AI action per turn against the V1 limits (10/min, 100/day); at most 5 tool steps; retrieved content capped (12 sources, 20,000 chars total, V1 budgets); history 10 messages.
- All retrieval and tools run server-side with the session user; ids from the model are re-checked against ownership before anything is read or proposed.
- **Prompt injection:** note and task text is untrusted data. Nothing in retrieved text can cause a tool call to write (no writing tools exist) or to widen scope (tools take only the user's own data). Proposals contain ids and strings that are validated and shown for review.
- Logs and `ai_usage` carry no prompts, answers, notes or tool payloads.
- AI failure never blocks the page; the assistant simply reports the failure and offers Retry.

---

## 8. Tests

**Unit**
- Tool input schemas; proposal schemas; label filtering of citations; quote verification; history trimming; prompt carries the version and the data rule.
- `proposeTaskChanges` rejects ids that are not the user's (given a fake data layer) and malformed payloads.
- Scripted mock turns: tool sequence, step cap, error mid-stream.

**Integration** (real routes and database, mock provider)
- **Scope:** every tool returns only the caller's data; a forged id from "the model" for another person's note is `NOT_FOUND` and never leaks; context ids are owner-checked.
- **No mutation:** a full assistant turn that proposes tasks changes no task rows; confirming through the commands creates exactly the ticked rows and one `audit_log` row without content.
- Rate limit with `retryAfterSeconds`; `AI_DISABLED`; usage row without text; failure path leaves no partial writes; step cap enforced.
- Citations: only provided labels survive; fabricated quotes are not shown as workspace quotes.
- Retrieval reasons in the response equal the search reasons (not model text).

**E2E** (mock provider)
1. Ask a question → streamed answer with source links → click a source opens it.
2. "Why" shows recorded reasons.
3. Follow-up question uses the thread context.
4. Ask about a note → proposals (create tasks) → untick one, edit a title → Confirm → exactly those tasks exist; one audit entry; Cancel changes nothing.
5. Related panel on a note lists neighbours; link action works.
6. Provider failure shows Retry and leaves the workspace unchanged; rate limit note; AI off hides everything; offline message.
7. Threads are local: sign out clears them; nothing is stored server-side (check `ai_usage` columns).
8. Axe, 360px, light and dark, reduced motion.

---

## 9. Definition of done

- [ ] The assistant answers questions from the person's own notes and tasks, cites them with working links, and can explain why each result was retrieved
- [ ] It can propose task creation, edits and links; nothing is written until the person confirms; confirmed changes are audited without content
- [ ] Every tool is owner-scoped and tested against cross-user attempts and prompt injection
- [ ] Threads live on the device only; nothing private is stored or logged by the server
- [ ] The workspace stays useful when the provider is unavailable, the feature is off, or the device is offline
- [ ] Related notes and tasks show on notes and task details without a model call
- [ ] The adapter and mock support tool use; CI makes no paid calls
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass
- [ ] `agent_docs/ai-assistant_v1.md` updated, and `agent_docs/ai-workspace-assistant_v2.md` written and indexed

---

## 10. Out of scope (V2)

Server-stored conversations or sharing; tools that write directly; autonomous agents or background actions from chat; voice conversation; web browsing tools; image understanding; long-term "memory" beyond the thread; assistants for team workspaces; calendar tools (added by 12 for planning, see its doc).
