# Feature 10 — Semantic Search

> **Revised 2026-10-13 (owner).** Four changes to the first draft, made after checking the spec against the built project: (1) indexing is driven by a **scheduled scan**, not by hooks in the task, todo, note and project mutations; (2) **recent items** are kept in the browser's `localStorage`, not Dexie; (3) the index **does not keep a second copy of each note's full text**, only hashes and the chunk text; (4) **pgvector must be installed first**. Offline search is deferred. This feature no longer depends on features 04 or 05.

## Prerequisites (check before starting)

- **Feature 08 is built:** the `jobs` table, `enqueue`, the handler registry, the scheduler (`job_schedules`) and tick mode. This feature adds job types to it and does not change its code.
- **pgvector is installed** everywhere the migration runs:
  - **Local development and tests:** the Homebrew Postgres 18 has no `vector` extension today. Install it (`brew install pgvector`; confirm the formula supports the installed PostgreSQL major version, restart Postgres) and make sure `CREATE EXTENSION IF NOT EXISTS vector` works in both `dayboard_dev` and `dayboard_test`. This changes the owner's machine, so ask first.
  - **Docker Compose:** the `db` service moves from `postgres:17` to `pgvector/pgvector:pg17` (feature 16 documents it). Docker is not installed on the development machine, so this is unverified here.
  - **CI:** a Postgres service image with pgvector.
  - **Production (Neon):** enable the extension on the project before running the migration. Neon documents pgvector support; confirm on the real project. Production migrations are run by hand.
- A **real embedding call** has been tried once with the owner's key before ADR 0011 is accepted (§3).

---

## 1. Scope

- **Hybrid search**: keyword (kept) plus vector similarity, merged into one ranked list, across tasks, todos, notes and projects
- **pgvector** storage, **chunking**, and a **background indexing pipeline** run by a scheduled scan on feature 08's jobs
- An **embedding provider** behind the AI adapter, with a deterministic mock for tests
- **Exact-phrase** search (`"quoted text"`), existing **filters** (type, status, project, tag, date), and **recent items** (the ones the person opened)
- **Result explanations** ("why this result") used by the search UI and the assistant (11)
- An explicit **opt-in** (Settings → AI) because indexing sends content to the provider, and an index status panel
- Graceful degradation: provider down or off means keyword results only, with a quiet note

Reuses: V1 search module (`src/lib/search/*`, `src/db/queries/search.ts` with `searchWorkspace` and `recentItems`, the `/api/search` route, the `/search` page, ⌘K), the AI adapter and mock (`src/lib/ai/*`), per-user AI limits and `ai_usage`, feature 08 jobs, scheduler and tick mode.

**Does not touch:** the task, todo, note and project mutation files, the sync change log (feature 05), or the Dexie schema (feature 04). Those are other features' files, and the scan makes them unnecessary.

Source spec sections: product §6, §2.1 row 4, §13 (search fast before fancy; useful without AI); technical §5, §6, §13, §14; project plan Phase 5.

---

## 2. Data model

One migration (next free number at build time), expand-only:

- `CREATE EXTENSION IF NOT EXISTS vector` (needs privileges; see Prerequisites).
- The two tables below, the `ai_feature` enum value `EMBED`, and `user_preferences.semantic_search_enabled`.
- Two indexes on the source tables for the scan: `todos (user_id, updated_at)` and `projects (user_id, updated_at)`. Tasks and notes already have one (`tasks_user_updated_at_idx`, `notes_user_updated_at_idx`). Check the query plans at build time and do not add an index the plan does not use.
- The `job_schedules` row for `embedding.scan` (feature 08's pattern: schedules are seeded by the migration of the feature that owns them).

### `search_documents`

One row per **indexed** entity. It records what was indexed; it does **not** copy the entity's text. Titles, text and status always come from the live tables.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `user_id` | FK → user, cascade |
| `entity_type` | `TASK, TODO, NOTE, PROJECT` |
| `entity_id` | uuid. Unique `(entity_type, entity_id)` |
| `content_hash` | text: hash of the title plus the entity's text at the time it was indexed |
| `source_updated_at` | timestamptz: the entity's `updated_at` that this index state corresponds to (what the scan compares) |
| `chunk_count` | integer |
| `status` | `INDEXED, EMPTY, FAILED`. `EMPTY` = nothing to embed (no title or text) |
| `failure_count`, `last_error_code` | a failing document is retried with the job backoff, then marked `FAILED` and left alone until the entity changes or the person presses Re-index |
| `indexed_at` | timestamptz |

Indexes: unique `(entity_type, entity_id)`, `(user_id, status)`.

### `embedding_chunks`

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `user_id` | FK → user, cascade (denormalised so every vector query filters by user) |
| `document_id` | FK → `search_documents`, cascade |
| `chunk_index` | integer |
| `text` | the chunk text (≤ ~2,000 chars) |
| `token_estimate` | integer |
| `embedding` | `vector(768)` |
| `model` | text, e.g. `gemini-embedding-001@768` |
| `content_hash` | hash of the chunk text (skip re-embedding unchanged chunks) |
| `created_at` | |

Index: `USING hnsw (embedding vector_cosine_ops)` plus btree `(user_id, document_id)`. The dimension and model are decided in ADR 0011 (Anthropic offers no embeddings; the Google provider package is already a dependency and has a free tier). Changing the model means a re-embed (the `model` column makes stale rows visible, §4).

**Text stored twice, kept to the minimum.** The chunk text is the only copy of an entity's text outside its own row. It is kept because the result snippet, the "why this result" passage and change detection need to know exactly what was embedded, without re-reading and re-chunking the entity on every search. The full `body_text` of the first draft (up to 200,000 characters per document) is **not** stored. This matters on a small database (Neon's free tier is 0.5 GB), and chunks are capped (§8).

The technical spec names an `embeddings` table; this design uses `embedding_chunks` and `search_documents` (with different columns from the first draft). Record the deviation in ADR 0011.

### Preferences

`user_preferences.semantic_search_enabled boolean NOT NULL default false`. Default **off**: indexing sends every note and task to the provider, which is a bigger disclosure than V1's on-demand AI actions, so it needs a deliberate choice.

### Recent items (browser storage, not Dexie)

`localStorage` key `dayboard:recent-items`: a JSON array, newest first, at most 8 entries of `{ type: "task" | "note" | "project", id, openedAt }`. Written when the person opens a task (panel or page), a note or a project. Every read and write is wrapped in `try/catch` (storage can be missing or blocked), and a failure means no history. Per device, not synced. Cleared on sign-out with the other browser-stored data. It holds ids and types only, never titles.

Why not Dexie: the local database holds tasks only today and its schema belongs to features 04 and 05. Recent searches already live in `localStorage` (`src/lib/search/recent.ts`), so this follows the same pattern. Todos have no page of their own, so they are not recorded.

---

## 3. Embedding provider

Extend the `AiProvider` interface (technical spec §6):

```ts
embed(input: string[], opts: { dimensions: 768; task: "document" | "query"; signal }): Promise<{ vectors: number[][]; usage }>
```

- **Real adapter:** `@ai-sdk/google` embeddings inside `src/lib/ai/providers/sdk.ts` (the only place the SDK is imported). Batches of up to 50 chunks; `taskType` document versus query where the model supports it. The installed packages expose what this needs (`embed` and `embedMany` in `ai`; `textEmbeddingModel`, `outputDimensionality` and `taskType` in `@ai-sdk/google`), checked in their type definitions only. The model name `gemini-embedding-001` and the 768-dimension option come from the first draft and **have not been called**: verify them against the provider with the owner's key before ADR 0011 is accepted.
- **Mock:** deterministic and offline. Tokenises, lower-cases, and maps words to **concept buckets** from a small fixture table (e.g. `authentication ≈ login, password, otp, 2fa, sign-in, credentials`; `performance ≈ slow, speed, fps, latency, render`), hashes remaining words into the 768 dimensions, L2-normalises. This lets tests find a note by meaning without the exact word and keeps CI free.
- **Limits and cost:** embeddings are background work, counted in `ai_usage` under feature `EMBED` (new enum value) and capped by `EMBED_DAILY_LIMIT` (default 2,000 chunks per user per day) so a free tier is not exhausted; the index status shows when a cap pauses indexing. Query embeddings count against the normal per-minute and per-day AI limits (one action per semantic search; keyword-only searches cost nothing).
- Errors never break search: a provider failure returns keyword results and a quiet note.

---

## 4. Indexing pipeline (a scheduled scan)

```text
job_schedules: embedding.scan (every 300 s)
  -> embedding.scan        lists people who turned semantic search on, enqueues one embedding.scan_user each
  -> embedding.scan_user   finds changed, new and gone entities for that person, enqueues embedding.index
  -> embedding.index       loads the entity fresh -> hashes -> chunks -> embeds changed chunks -> upserts
```

**Why a scan, not hooks.** Nothing in the task, todo, note or project mutations changes. Only tasks write the sync change log today (feature 05), so a change-log trigger would not cover notes at all, and hooking every mutation would touch many files that belong to other features. A scan also fits the production profile (jobs run on a tick, so there is no real-time promise to keep), backfills for free, and repairs itself: a missed change is caught on the next pass instead of leaving the index stale for good.

### Jobs (all on feature 08's queue `ai`; handlers in `src/worker/handlers/embedding.ts`)

| Type | Runs | Does |
|---|---|---|
| `embedding.scan` | every 300 s (a `job_schedules` row; the cron form follows feature 08's) | Lists people with `semantic_search_enabled`, and enqueues one `embedding.scan_user` per person (`dedupe_key` `embedding.scan_user:<user>:<window>`). Nothing is read or sent for a person who has not opted in |
| `embedding.scan_user` | per person (job `user_id` set) | Runs the three queries below, enqueues up to **200** `embedding.index` jobs and removes gone documents. The rest are picked up on the next scan, because an indexed item drops out of the "changed" list. This is the backfill: turning the switch on needs nothing more |
| `embedding.index` | per entity (payload: `{ entityType, entityId }`; ownership comes from `jobs.user_id`) | Indexes one entity (below). `dedupe_key` `embedding.index:<type>:<id>` so two scans never queue the same item twice |

### What the scan looks for (per person, per type, all index-backed)

1. **New or changed:** an eligible entity with no `search_documents` row, or whose `updated_at` is later than the row's `source_updated_at`, or whose row is `INDEXED` with chunks from another `model`. Rows that are `FAILED` are skipped until the entity changes or Re-index runs.
2. **Gone:** a `search_documents` row whose entity no longer exists, is in Trash, or is archived. These rows are **deleted straight away** by the scan (chunks cascade). No model call is needed. Archived items come back when unarchived (they then count as changed).
3. **Backlog count:** the size of (1) minus the jobs already queued, kept for the status panel and a log line (counts only).

Eligibility matches the keyword search for each type (live, not in Trash, not archived).

The scan stops adding work for a person who hit `EMBED_DAILY_LIMIT` (§3) and records `paused` for the status panel.

**Assumption to protect:** every content change bumps `updated_at`. That already holds for the Drizzle-based mutations. A code path that changes text with raw SQL and skips `updated_at` would be missed; the "gone" check is based on state, not time, so it is not affected. Re-index (§6) is the repair for anything missed.

### `embedding.index` for one entity

1. Load the entity **fresh by id and owner**; if it is gone, trashed or archived, delete its document and stop.
2. Project its text with the existing text columns (`content_text`, `description_text`, the project description). Compute `content_hash` of title plus text. If it equals the stored hash and the chunks' model is current, only update `source_updated_at` and finish: **no model call**. An edit that changes no text (a status change, a due date) therefore costs nothing.
3. Chunk (`src/lib/search/chunk.ts`, pure):
   - Notes: split by headings and paragraphs into chunks of about 300–500 tokens with a small overlap; each chunk is prefixed with the note title and its nearest heading; toggle, callout, table and list text included; empty blocks skipped.
   - Tasks and todos: title + description as one chunk (description capped at 2,000 tokens).
   - Projects: name + description.
4. Compare chunk hashes; embed only new or changed chunks (batches of up to 50); delete removed chunks; upsert in one transaction; set `content_hash`, `source_updated_at`, `chunk_count`, `status`, `indexed_at`. An entity with nothing to embed becomes `EMPTY`.
5. **Idempotent** and safe to run twice (feature 08 jobs are at-least-once). Failures retry with feature 08's backoff; after the last attempt the document is marked `FAILED` with a code, not retried forever.

### Opt-in gate

Nothing is scanned or sent unless `semantic_search_enabled` and the provider is configured. Turning it on saves the preference; the next scan (within about five minutes) starts the backfill, and **Start now** in Settings enqueues `embedding.scan_user` for the person at once. Turning it off **deletes the person's `search_documents` and chunks** and stops scanning for them; keyword search is untouched.

### How fresh is it?

Keyword results are always live (they read the tables). Semantic results lag: up to one scan interval plus the time to run the index jobs. With a worker that is a few minutes; on the tick profile (Vercel with a GitHub Actions tick every 5 minutes) it is typically one to two ticks, so **up to about 10 minutes**. Settings says so, and search never promises more.

---

## 5. Search pipeline

```text
query -> parse (phrases, filters) -> keyword search (existing, ILIKE)  --+
                                  -> query embedding -> vector kNN       +-> merge (RRF) -> boosts -> results
```

1. **Parse** (`src/lib/search/parse.ts`, pure): text split into terms and `"quoted phrases"`. A phrase must appear (case-insensitive substring in the title or in the entity's own text column, read from the live table) for a result to rank as a phrase match and gets a strong boost; a query that is only a quoted phrase runs as keyword-only.
2. **Keyword branch:** the existing lexical search unchanged in behaviour (prefix, then contains, then recency), now also fed the phrase operator. It is **never replaced** by vectors (technical §5).
3. **Vector branch:** `SELECT document_id, 1 - (embedding <=> $q) AS score FROM embedding_chunks WHERE user_id = $1 ORDER BY embedding <=> $q LIMIT 60`, with pgvector's iterative index scan enabled for filtered queries (`SET LOCAL hnsw.iterative_scan = relaxed_order`; set `hnsw.ef_search` per query) so a user-scoped query returns enough candidates. Group chunks by document and keep the best chunk as the snippet. Drop scores under a minimum similarity (tuned with fixtures).
4. **Filters** (type, status, project, tag, date range) are applied to **both** branches by joining the live entity tables (status, project and dates come from the source tables, never from stale index rows).
5. **Merge:** Reciprocal Rank Fusion (`k = 60`) over the two ranked lists, plus small boosts: exact phrase (+), title match (+), recency (a gentle decay), open task over done. Output is paged (20 per page).
6. **Result shape:** `{ type, id, title, emoji, project, snippet, matchKind: "keyword" | "semantic" | "both", score, reasons }`, where `reasons` records which branch matched, the best chunk text, and (for keyword) the matched terms. This metadata is generated by the server, **not by a model**, and is what the UI and the assistant use to explain a result. The title and emoji always come from the live row; a semantic snippet comes from the stored chunk and can lag the note by one scan, which the result's reason text allows for ("the passage as last indexed").
7. **Authorization:** every query carries `user_id`; a test proves another person's nearest vector is never returned. The final result rows are re-checked against the live entity tables (deleted, archived and other-owner rows are dropped).

`searchWorkspace(userId, params)` stays the single function used by the Search page, ⌘K and the assistant tools (11), extending the V1 function of the same name.

---

## 6. Server contract

| Route / action | Purpose |
|---|---|
| `GET /api/search?q=&type=&status=&project=&tag=&from=&to=&mode=` | Replaces the V1 query path for the Search page; `mode=keyword` forces keyword only. Zod-validated, `requireUser()`, `no-store`. Returns results with `semantic: "used" \| "off" \| "unavailable"` so the UI can say why only keyword results appear. |
| `GET /api/search?recent=1&open=task:<id>,note:<id>,…` | Extends the V1 recent route. `open` carries up to 8 refs from the browser's recent list. The server loads only those that belong to the person and are live (not in Trash, not deleted), keeps the given order, and returns them as search hits. With no `open` (a new device, or empty storage) it returns V1's five most recently updated items. Refs are never trusted: ownership and existence are checked per ref. |
| `setSemanticSearch({ enabled })` (Server Action, `src/actions/settings.ts`) | Toggles the preference; on disable deletes the person's index. On enable it only saves the preference (the next scan starts the backfill). |
| `startSemanticIndexing()` | Enqueues `embedding.scan_user` for the person now (rate-limited, once per minute). |
| `getSearchIndexStatus()` | `{ enabled, eligible, indexed, backlog, failed, lastIndexedAt, paused, model }` for Settings; counts only. |
| `reindexSearch()` | Marks every document stale and runs the scan with `force`, which re-embeds all chunks (use after a model change or a suspected miss). Rate-limited, once per hour. |

Existing V1 search pages keep working; `/search` and ⌘K call `searchWorkspace`.

---

## 7. UI

- **Search page and ⌘K:** same layout (V1). Result rows may show a quiet text label for the match kind ("Matches your words" / "Related meaning" / "Both"): plain text, no sparkle icon, no AI badge (DESIGN.md). A **Why this result** disclosure shows the stored reasons: matched terms or the best matching passage, and for semantic matches "Found because its meaning is close to your search." Exact-phrase queries show a "Phrase" label.
- **Exact phrase:** typing quotes works; a small hint under the box: `Use "quotes" to match an exact phrase.`
- **Recent items:** with an empty query, ⌘K and `/search` list **Recent items**: the ones the person opened last (up to 8, from `localStorage`, resolved by the server, §6), above recent searches. Items that are gone or in Trash are dropped by the server and pruned from storage on the next write. A new device or blocked storage falls back to the five most recently updated items, as V1 does.
- **States:** semantic off (a one-line invitation with a link to Settings, shown once per session), indexing in progress ("Still indexing 38 items. Results may be incomplete."), provider unavailable ("Showing keyword results only."). Nothing blocks the search.
- **Settings → AI → Semantic search:** the opt-in switch with the plain disclosure ("Your notes and tasks are sent to <provider> to build a search index. They are not stored by Dayboard anywhere else. You can turn this off and the index is deleted."), the Gemini free-tier data note when relevant, index status (indexed X of Y, waiting, failed, last indexed, paused reason), the freshness line ("Meaning-based results can take up to about 10 minutes to reflect new changes. Keyword results are always current."), **Start now** and **Re-index**.
- **Offline:** not part of this feature. Search needs a connection, as it does today. Recent items still list from storage, and opening one follows the offline rules of feature 04. A local keyword search over the Dexie data belongs to feature 04's offline screens and arrives with notes offline (`../features/04-local-persistence-and-offline.md`); this feature neither builds nor blocks it.
- Search results link directly to the originating task or note (product §6): tasks open the panel, notes open at the note (and, for a semantic hit inside a long note, with the matched passage highlighted when the editor can find it).

---

## 8. Rules and limits

- **Privacy:** note text goes to the provider only for chunks being embedded and only after opt-in; chunk text is stored in our database (the only duplicate of an entity's text, §2); logs carry ids and counts, never text.
- **No cross-user data:** per-user filters on every query; tests enforce it.
- **No other feature's files change:** the scan reads the source tables; it does not add calls to any task, todo, note or project mutation.
- **Fast before fancy:** the keyword branch and the vector branch run in parallel; if the vector branch exceeds 800 ms the keyword results are returned and the semantic ones are appended when ready (the UI updates), so search never feels slower than V1.
- **Sizes:** at most 200 chunks per document; documents over the cap index the first 200 chunks. At most 200 index jobs are queued per person per scan.
- **Re-embedding on model change:** documents with chunks from another `model` count as changed in the scan and are re-embedded gradually (within the daily cap); searches ignore rows with an old model.
- **Deletion:** deleting an entity or the user removes its documents and chunks (cascade, or the scan's "gone" step); disabling removes all.

---

## 9. Tests

**Unit**
- Chunker: headings, long paragraphs, overlap, tables and toggles, size caps, title prefixing, empty content.
- Query parser: terms, phrases, unbalanced quotes, filters.
- RRF merge and boosts; minimum-similarity cut; deterministic ordering.
- Mock embedder: concept buckets (authentication ≈ login/OTP), normalised length, determinism.
- Hash-based change detection (only changed chunks re-embedded; a title or text change is detected, a status or date change is not).
- Recent-items store: add, de-duplicate, cap at 8, ignore malformed JSON and unavailable storage.

**Integration** (test database with pgvector)
- Index a set of documents with the mock embedder; "authentication problems" finds a note that says "login failures with OTP" without a keyword overlap; "OTP security" finds the related task.
- **Scan:** a new entity is picked up; an edited one is re-queued; an unchanged one is not; an edit that changes no text updates `source_updated_at` and makes **no embed call** (the mock records its calls); a trashed, archived or deleted entity has its document removed by the scan; a `FAILED` document is skipped until the entity changes; the per-scan cap of 200 and the daily cap pause correctly; a person who has not opted in is never scanned, never read and never sent; one person's scan never enqueues work for another (`jobs.user_id`); two scans do not queue the same item twice (dedupe).
- Hybrid: a phrase query ranks the exact match first; keyword-only and semantic-only hits both appear; `matchKind` correct.
- **Authorization:** user A's query never returns user B's chunks even when B's vector is the nearest; deleted, archived and trashed items are dropped; filters (status, project, tag, dates) apply to both branches.
- Opt-in off: nothing scanned or sent (the mock records zero calls); on: the scan indexes; off again: documents and chunks deleted.
- Provider failure returns keyword results with `semantic: "unavailable"`.
- Worker: the index job is idempotent (run twice, same rows); a changed model re-embeds.
- Recent route: refs for another person's or a trashed item are omitted; the order is kept; no `open` returns the V1 list; malformed refs are ignored.
- The migration applies on a database with pgvector and fails clearly without it.

**E2E**
1. Enable semantic search; run the scan (test hook or the tick endpoint); the index status completes; a meaning-only query finds the related note; the result links to it; "Why this result" explains.
2. A quoted phrase query; filters narrow results.
3. Open a few items; the empty ⌘K and `/search` list them as recent items, most recent first; trash one and it disappears from the list.
4. Disable: documents and chunks gone, search still works.
5. Semantic off shows the one-time invitation; the indexing-in-progress note appears while the backlog is not zero.
6. Axe, 360px, light and dark.

---

## 10. Definition of done

- [ ] pgvector works in the dev and test databases, the Docker `db` image, CI and the production database (Neon), and the migration enables it
- [ ] A semantic query finds a related note or task without an exact keyword match, and results link to the item
- [ ] Hybrid ranking keeps keyword search intact; exact phrases, filters and recent items work
- [ ] No result ever includes another person's data (tested), nor trashed or archived items
- [ ] Indexing is opt-in, runs as a scheduled scan on feature 08's jobs, is idempotent, capped and visible (status, backlog, start now, re-index); disabling deletes the index
- [ ] No task, todo, note or project mutation file, no change-log code and no Dexie schema is changed by this feature
- [ ] The index stores hashes and chunk text only, never a second copy of each entity's full text
- [ ] Recent items come from `localStorage`, are resolved and checked by the server, and the V1 list is the fallback
- [ ] The workspace stays fully useful with the provider down or the feature off
- [ ] "Why this result" reasons are server-generated facts, usable by the assistant
- [ ] CI runs with the mock embedder and a pgvector Postgres; no paid calls
- [ ] ADR 0011 written before building: the provider and dimension (verified with a real call), the table design (including the deviation from the technical spec's table name), scan-based indexing instead of mutation hooks, no full-text copy, and `localStorage` recent items
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/semantic-search_v2.md` written and indexed

---

## 11. Out of scope (V2)

Search over file contents or voice transcripts; cross-encoder re-ranking; query rewriting by an LLM; per-language analyzers and stemming; **offline search** (a local keyword search belongs to feature 04's offline screens and waits for notes offline); indexing triggered from mutations or from the sync change log; synced recent items across devices; saved searches; search suggestions as you type from the vector index.
