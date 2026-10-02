# Feature 05 — AI Assistant

## 1. Scope

- AI foundation: provider adapter, mock provider, Zod output schemas, versioned prompts, usage tracking, rate limits, per-user AI toggle
- AI features A–G from product spec §7.2, plus the task-detail assist actions (§6.5) and Inbox classification (§6.9)
- UI slots already reserved by features 02–04 (task detail AI section, note actions, Inbox suggestion, Today card, command menu "Ask" mode)

Every AI change to data follows **Generate → Preview → User confirms → Persist** (Agent.md §8). Persisting always goes through the normal Server Actions from features 02–04, so AI output gets the same validation and ownership checks as user input.

Source spec sections: product §7, §8; technical §13–15; UI/UX §13, §14; project plan Phases 9–10.

---

## 2. Provider adapter

```text
src/lib/ai/
  index.ts        AIService facade used by route handlers
  provider.ts     adapter selection by AI_PROVIDER
  providers/
    sdk.ts        real provider via the Vercel AI SDK (`ai` + provider package)
    mock.ts       deterministic fixtures per feature, for tests/CI/dev
  schemas.ts      Zod output schemas (one per feature)
  prompts.ts      versioned prompts, e.g. EXTRACT_TASKS_V1
  context.ts      workspace retrieval + bounding (ownership-checked)
  usage.ts        limits + ai_usage accounting
```

```ts
interface AIService {
  generateStructured<T>(opts: { feature: AIFeature; schema: ZodType<T>; system: string; input: string; maxOutputTokens: number }): Promise<T>;
  streamText(opts: { feature: AIFeature; system: string; input: string; maxOutputTokens: number }): ReadableStream;
}
```

- The **Vercel AI SDK** implements the real adapter. It already supports Zod-typed structured output, streaming and many providers, so switching providers is a config change (product spec §7.1). Only `ai` and the one provider package in use are installed.
- `embed()` is **not** implemented in V1. It's a V2 extension point, noted in a comment only.
- Model choice comes from env, never hard-coded: `AI_MODEL` (default for most features) and `AI_MODEL_FAST` (for classification and the daily suggestion). Example `.env.example` values: `AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5`, `AI_MODEL_FAST=claude-haiku-4-5-20251001`.
- `AI_PROVIDER=mock` is the default in development and **always** in CI (Agent.md §8). The mock returns fixtures keyed by feature and can be forced into an error mode with `AI_MOCK_MODE=error|slow`.
- Provider timeout 30s (structured) / 60s (stream). One automatic retry on 5xx or timeout for structured calls only.

### Environment

| Variable | Notes |
|---|---|
| `AI_PROVIDER` | `anthropic` \| `openai` \| `mock` (only adapters actually built) |
| `AI_MODEL`, `AI_MODEL_FAST` | model IDs |
| `AI_API_KEY` | server-only. Never `NEXT_PUBLIC_`. |
| `AI_BASE_URL` | optional (proxy/self-hosted gateway) |
| `AI_LIMIT_PER_MINUTE` | default 10 |
| `AI_LIMIT_PER_DAY` | default 100 |

If `AI_PROVIDER` isn't `mock` and `AI_API_KEY` is missing, AI is **globally unavailable**: AI UI hides itself and the rest of the app works normally. The app must not crash.

---

## 3. Data model

### `ai_usage`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user, cascade | |
| `feature` | enum (see §5 feature keys) | |
| `provider`, `model` | text | |
| `status` | enum `SUCCESS, PROVIDER_ERROR, VALIDATION_ERROR, RATE_LIMITED` | |
| `input_tokens`, `output_tokens` | integer NULL | when the provider reports them |
| `latency_ms` | integer | |
| `prompt_version` | text | e.g. `EXTRACT_TASKS_V1` |
| `created_at` | timestamptz | |

Index: `(user_id, created_at DESC)`. **No prompt or output text is stored** (product spec §8).

### `ai_daily_suggestions`

| Column | Notes |
|---|---|
| `user_id` + `local_date` | PK. One suggestion per user per local day. |
| `text` | ≤ 280 chars |
| `created_at` | |

Stored because regenerating on every Today visit would waste quota. The user expects to see it again that day.

`inbox_items.ai_suggestion` (declared in 04) stores `{ type, title, confidence: "high" | "medium" }` only.

---

## 4. Request pipeline (every AI route)

All AI endpoints are **Route Handlers** under `src/app/api/ai/` (technical spec §3: streaming + independent request control).

1. `requireUser()` → `UNAUTHENTICATED`
2. AI globally available and `user_preferences.ai_enabled` → else `AI_DISABLED` (new error code, added to technical spec §17)
3. Zod-validate the request. Input text max 20,000 chars → `VALIDATION_ERROR`.
4. `usage.checkLimits(userId)`: count `ai_usage` rows in the last minute and in the current local day → `RATE_LIMITED` with a `retryAfterSeconds` field. Rate-limited attempts are recorded too.
5. Load referenced records **by ID + user ID** (never trust client-sent content for a stored record; e.g. "summarize note" sends `noteId`, not the note body).
6. Build the prompt from `prompts.ts`. Workspace content is wrapped in delimited blocks, and the system prompt tells the model to treat it as data, not instructions.
7. Call the provider. Validate structured output with the feature's Zod schema. On invalid output, retry once with a repair hint, then fail with `AI_PROVIDER_ERROR`.
8. Record `ai_usage`. Return the result or stream.

Error UI: every AI surface has the states Ready / Generating / Complete / Failed + Retry (UI/UX §13). AI never blocks the page.

---

## 5. Features

| Key | Feature | Trigger (UI) | Endpoint | Output | Model |
|---|---|---|---|---|---|
| `EXTRACT_TASKS` | **A. Text → tasks** | Inbox item "Turn into tasks", command menu Create mode | `POST /api/ai/extract-tasks` `{ text }` or `{ inboxItemId }` | structured | default |
| `SUBTASKS` | **B. Break into subtasks** | Task detail | `POST /api/ai/subtasks` `{ taskId }` | structured | default |
| `SUMMARIZE_NOTE` | **C. Summarize note** | Note overflow → Summarize | `POST /api/ai/summarize-note` `{ noteId }` | streamed text in 3 labelled sections | default |
| `ACTION_ITEMS` | **D. Extract action items** | Note → "Extract tasks" | `POST /api/ai/action-items` `{ noteId }` | structured | default |
| `ASK` | **E. Ask my workspace** | Command menu "Ask" mode | `POST /api/ai/ask` `{ question }` | stream + sources | default |
| `DAILY` | **F. Daily suggestion** | Today card (lazy, client-side after render) | `GET /api/ai/daily-suggestion` | cached text | fast |
| `OVERDUE_CLEANUP` | **G. Overdue cleanup** | Today Overdue section → "Help me clean up" | `POST /api/ai/overdue-cleanup` | structured | default |
| `TASK_ASSIST` | Task-detail actions | Task detail AI menu | `POST /api/ai/task-assist` `{ taskId, mode }` | structured | default |
| `CLASSIFY_INBOX` | Inbox classification | Inbox item "Suggest" | `POST /api/ai/classify-inbox` `{ inboxItemId }` | structured, stored | fast |

### Output schemas (summary; full definitions in `schemas.ts`)

- **A / D:** `{ items: [{ title (1–200), dueDate? (ISO date, only if stated explicitly), owner? (only if named explicitly), evidence? (≤ 80 chars, e.g. "Found in paragraph 3") }] }`, max 15 items. Relative dates ("tomorrow") resolve using the user's timezone, which is passed in the prompt.
- **B:** `{ subtasks: [{ title }] }`, 3–8 items
- **C:** stream with fixed headings `Summary`, `Key points`, `Action items`. Rendered as plain text + lists (no raw HTML) with an "AI-generated" label.
- **G:** `{ proposals: [{ taskId, action: KEEP | RESCHEDULE | ARCHIVE | CANCEL, newDueDate?, reason (≤ 100 chars) }] }`. `taskId` must be one of the overdue task IDs sent. Others are dropped.
- **Task assist** modes: `REWRITE_DESCRIPTION` / `CLARIFY` → `{ title?, description (plain text → converted to Tiptap paragraphs) }`. `ESTIMATE` → `{ estimate: "≤15m" | "≤1h" | "half-day" | "1 day" | "multi-day", rationale }` (shown only, never saved; product spec §6.5). `NEXT_STEPS` → `{ steps: [string] }` (shown; each step can be turned into a subtask on click).
- **Classify:** `{ type: TASK | TODO | NOTE | TASK_AND_NOTE | PROJECT_IDEA, title, confidence }`

### Preview & confirm

| Feature | Preview UI | Persist via |
|---|---|---|
| A, D | Checklist dialog: every item editable (title, due date), all ticked by default, button "Create N tasks" | `createTasksBatch` (new Server Action in feature 02's `tasks.ts`, max 15, one transaction). For D, created tasks are auto-linked to the source note. |
| B | Inline list under Subtasks with checkboxes, "Add N subtasks" | `createTasksBatch` with `parentTaskId` |
| G | Per-task row with the proposed action (changeable) + "Apply" | existing `updateTask` / `archiveTask` / `setTaskStatus`, one call per accepted row |
| Task assist rewrite/clarify | Side-by-side current vs proposed, "Replace" / "Discard" | `updateTask` / `updateTaskDescription` |
| Classify | Inbox row chip: "Looks like a task: 'Prepare client call notes' [Create task] [Dismiss]" | opens the feature 04 conversion dialog pre-filled. The user still confirms. |

Nothing is written before the user clicks the confirm button.

---

## 6. Ask my workspace (E)

Retrieval, following technical spec §14. No vectors.

1. **Normalize:** lower-case, strip stop-words, keep up to 8 keywords. No model call.
2. **Candidate search:** reuse `src/lib/search` over tasks, todos, notes, projects and tags. Up to 40 candidates.
3. **Rank:** search score + title bonus + recency bonus (≤ 30 days) + a relation bonus when a candidate's project/tag matches another top candidate.
4. **Bound:** top 12 items, each trimmed to ~1,500 chars around the match. Total context ≤ ~24,000 chars.
5. **Prompt:** each item labelled `[S1]…[S12]` with type and title. The model answers using only these and cites labels inline.
6. **Stream** the answer. Then the server sends a final `sources` event with the cited labels mapped to `{ type, id, title }`. **Cited labels that weren't provided are dropped** (UI/UX §14: never invent sources).
7. If nothing relevant is found, the model isn't called. Reply: "I couldn't find anything about that in your workspace." (no quota used).

UI: answer text, then a "Sources" list of clickable links. Directly quoted snippets are marked "From your workspace". The rest is labelled as AI synthesis.

---

## 7. Daily suggestion (F)

- The Today page renders first, then the client requests `/api/ai/daily-suggestion`.
- The server returns today's `ai_daily_suggestions` row if it exists. Otherwise it builds **deterministic stats** (overdue count, due-today count, high-priority count, completed yesterday) and asks the fast model for one or two calm sentences (≤ 280 chars) using only those stats. No task titles are sent.
- Failure or AI disabled → the card doesn't render. Today is unaffected.
- A "Refresh" control is limited to one regeneration per day.

---

## 8. Settings → AI

- Toggle "Enable AI features" (`ai_enabled`). Off hides every AI surface, and the server rejects AI calls with `AI_DISABLED`.
- Usage: "12 of 100 AI actions used today", resetting at local midnight.
- Data processing notice: which provider is used, that only the minimum relevant content is sent per action, that prompts and outputs aren't stored (except Inbox suggestions and the daily suggestion), and a link to the provider's data policy.

---

## 9. Tests

**Unit**
- Every Zod output schema (valid, invalid, oversize)
- `context.ts`: user scoping, item cap, char budget, stop-word normalization
- Citation filter drops unknown labels
- `checkLimits` per-minute and per-day boundaries, local-midnight reset
- Relative date resolution in the user's timezone
- Overdue cleanup drops proposals for task IDs that weren't sent

**E2E (mock provider only)**
1. Text → tasks: preview → untick one → edit a title → create → exactly those tasks exist
2. Break into subtasks → add 3 → they appear under the task
3. Summarize note streams three labelled sections
4. Extract action items → created tasks are linked to the note
5. Ask: answer + clickable sources that open the right records
6. `AI_MOCK_MODE=error` → Failed state + Retry, rest of page works
7. Rate limit: exceeding the per-minute limit shows a friendly "Try again in N seconds"
8. AI toggle off → no AI buttons anywhere. A direct POST returns `AI_DISABLED`.
9. Isolation: asking about user B's content as user A returns "couldn't find anything"

---

## 10. Definition of done

- [ ] All features A–G, task assist and Inbox classification work end to end with the mock provider and a real provider
- [ ] No AI path writes data without an explicit confirm click
- [ ] API key absent from client bundles (CI check: grep the `.next/static` output for the key variable name and `sk-` patterns)
- [ ] Limits enforced server-side. Usage visible in Settings.
- [ ] App fully usable with AI disabled, misconfigured or failing
- [ ] CI makes zero paid AI calls

---

## 11. Out of scope (V1)

- Embeddings / semantic search, AI weekly review, auto-scheduling
- Chat history or multi-turn conversations in Ask (each question is independent)
- Background/automatic AI runs (everything is user-triggered, except the lazily loaded daily card)
- Per-user model selection

---

## 12. As built (2026-10-02)

Where the build differs from the text above (details in `agent_docs/ai-assistant_v1.md`):

- **Providers (§2):** `AI_PROVIDER` accepts `anthropic` and `mock`; `openai` is not wired (ADR 0004). Without a key, a real provider means AI is off for everyone. `E2E=true` always uses the mock.
- **Mock (§2):** besides `AI_MOCK_MODE`, the markers `[mock:error]` and `[mock:slow]` in a call's text fail or delay that call only.
- **Data (§3):** `ai_daily_suggestions` also has `refresh_count`, which enforces one refresh a day. Rate-limited rows are written but not counted toward limits. The daily count is midnight to midnight in the person's time zone.
- **Pipeline (§4):** routes return `{ data }` or `{ error }`. A `RATE_LIMITED` error carries `retryAfterSeconds` and a `Retry-After` header. Streams are newline-delimited JSON events (`text`, `sources`, `error`, `done`).
- **Features (§5):** relative due dates ("Friday", "Oct 3") are resolved on the server against the person's own day (`src/lib/dates/resolve.ts`); a phrase that can't be resolved leaves the date empty. Classify stores nothing for a low-confidence answer. "Turn into tasks" on an inbox item also marks the item converted (`createTasksBatch` with `fromInboxItemId`). Overdue proposals start ticked for Keep and Reschedule and unticked for Archive and Cancel.
- **Ask (§6):** the relation bonus uses a shared project only. Quoted lines (`> `) are labelled "From your workspace" only when the server finds that text in a record it sent. Citations show as `[1]`, and a label that wasn't provided is removed.
- **Daily (§7):** the first Today visit of the day makes the call (counts as one action); later visits read the stored row.
- **Tests (§9):** unit, integration (real routes and database with the mock) and 19 Playwright tests. The nine listed scenarios are covered, plus rewrite, estimate/next steps, Inbox suggestion, overdue cleanup, the daily card and direct-request checks. The key check is `pnpm check:bundle`.
