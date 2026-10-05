# Feature 10 — Semantic Search

## 1. Scope

- **Hybrid search**: keyword (kept) plus vector similarity, merged into one ranked list, across tasks, todos, notes and projects
- **pgvector** storage, **chunking**, and a **background indexing pipeline** (feature 08 jobs)
- An **embedding provider** behind the AI adapter, with a deterministic mock for tests
- **Exact-phrase** search (`"quoted text"`), existing **filters** (type, status, project, tag, date), and **recent items**
- **Result explanations** ("why this result") used by the search UI and the assistant (11)
- An explicit **opt-in** (Settings → AI) because indexing sends content to the provider, and an index status panel
- Graceful degradation: offline or provider down means keyword results only, with a quiet note

Reuses: V1 search module (`src/lib/search/*`, `src/db/queries/search.ts`, `/search` page, ⌘K), the AI adapter and mock (`src/lib/ai/*`), per-user AI limits and `ai_usage`, feature 08 jobs, feature 05 change feed for re-indexing triggers, feature 04 local data for offline keyword search.

Source spec sections: product §6, §2.1 row 4, §13 (search fast before fancy; useful without AI); technical §5, §6, §13, §14; project plan Phase 5.

---

## 2. Data model

pgvector must be available: migration `CREATE EXTENSION IF NOT EXISTS vector` (needs privileges; the Docker `db` service switches to the `pgvector/pgvector:pg17` image, managed Postgres such as Neon enables it from its dashboard; documented in feature 16).

### `search_documents`

One normalised row per indexable entity.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `user_id` | FK → user, cascade |
| `entity_type` | `TASK, TODO, NOTE, PROJECT` |
| `entity_id` | uuid. Unique `(entity_type, entity_id)` |
| `title` | text |
| `body_text` | text, the projection (`content_text`, `description_text`, project description), capped at 200,000 chars |
| `content_hash` | text, hash of title + body (change detection) |
| `indexed_hash` | text NULL, hash that was last embedded |
| `indexed_at`, `updated_at` | timestamptz |

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

Index: `USING hnsw (embedding vector_cosine_ops)` plus btree `(user_id, document_id)`. The dimension and model are decided in ADR 0011 (Anthropic offers no embeddings; the Google provider package is already a dependency and has a free tier). Changing the model means a re-index job (the `model` column makes stale rows visible).

The tech spec names `embeddings`; this design folds vectors into `embedding_chunks` and keeps `search_documents`. Record the deviation in the ADR.

### Preferences

`user_preferences.semantic_search_enabled boolean NOT NULL default false`. Default **off**: indexing sends every note and task to the provider, which is a bigger disclosure than V1's on-demand AI actions, so it needs a deliberate choice.

### Local (Dexie)

`recent` store (`entityType`, `entityId`, `openedAt`, `count`): **recent items stay on the device** (not synced), updated when an item is opened.

---

## 3. Embedding provider

Extend the `AiProvider` interface (technical spec §6):

```ts
embed(input: string[], opts: { dimensions: 768; task: "document" | "query"; signal }): Promise<{ vectors: number[][]; usage }>
```

- **Real adapter:** `@ai-sdk/google` embeddings inside `src/lib/ai/providers/sdk.ts` (the only place the SDK is imported). Batches of up to 50 chunks; `taskType` document versus query where the model supports it.
- **Mock:** deterministic and offline. Tokenises, lower-cases, and maps words to **concept buckets** from a small fixture table (e.g. `authentication ≈ login, password, otp, 2fa, sign-in, credentials`; `performance ≈ slow, speed, fps, latency, render`), hashes remaining words into the 768 dimensions, L2-normalises. This lets tests find a note by meaning without the exact word and keeps CI free.
- **Limits and cost:** embeddings are background work, counted in `ai_usage` under feature `EMBED` (new enum value) and capped by `EMBED_DAILY_LIMIT` (default 2,000 chunks per user per day) so a free tier is not exhausted; the index status shows when a cap pauses indexing. Query embeddings count against the normal per-minute and per-day AI limits (one action per semantic search; keyword-only searches cost nothing).
- Errors never break search: a provider failure returns keyword results and a quiet note.

---

## 4. Indexing pipeline

```text
mutation / sync apply -> enqueue embedding.index (dedupe_key "entity_type:id", run_at = now()+30s)
embedding.index -> load document -> normalise -> chunk -> embed new/changed chunks -> upsert -> mark indexed
```

- **Triggers:** every create, update, soft delete or restore of a task, todo, note or project (inside the mutation transaction, via the same helper that writes the change log). The 30-second delay and dedupe key collapse a burst of autosaves into one job.
- **Opt-in gate:** nothing is enqueued or sent unless `semantic_search_enabled` and the provider is configured. Turning it on enqueues `embedding.backfill` (pages through the user's entities and enqueues index jobs, rate-limited). Turning it off **deletes the person's embedding rows** and stops indexing; keyword search is untouched.
- **Chunking** (`src/lib/search/chunk.ts`, pure):
  - Notes: split by headings and paragraphs into chunks of about 300–500 tokens with a small overlap; each chunk is prefixed with the note title and its nearest heading; toggle, callout, table and list text included; empty blocks skipped.
  - Tasks and todos: title + description as one chunk (description capped at 2,000 tokens).
  - Projects: name + description.
  - Trashed and archived items are removed from the index (archived can be re-added when unarchived).
- **Change detection:** unchanged chunk hashes are kept; only new or changed chunks are embedded; removed chunks deleted.
- **Idempotent** and safe to run twice; failures retry with backoff; a permanently failing document is marked and skipped, not retried forever.
- **Backlog metric** (technical §14): count of documents where `indexed_hash ≠ content_hash`, shown in Settings and logged.

---

## 5. Search pipeline

```text
query -> parse (phrases, filters) -> keyword search (existing, ILIKE)  --+
                                  -> query embedding -> vector kNN       +-> merge (RRF) -> boosts -> results
```

1. **Parse** (`src/lib/search/parse.ts`, pure): text split into terms and `"quoted phrases"`. A phrase must appear (case-insensitive substring in title or body) for a result to rank as a phrase match and gets a strong boost; a query that is only a quoted phrase runs as keyword-only.
2. **Keyword branch:** the existing lexical search unchanged in behaviour (prefix, then contains, then recency), now also fed the phrase operator. It is **never replaced** by vectors (technical §5).
3. **Vector branch:** `SELECT document_id, 1 - (embedding <=> $q) AS score FROM embedding_chunks WHERE user_id = $1 ORDER BY embedding <=> $q LIMIT 60`, with pgvector's iterative index scan enabled for filtered queries (`SET LOCAL hnsw.iterative_scan = relaxed_order`; set `hnsw.ef_search` per query) so a user-scoped query returns enough candidates. Group chunks by document and keep the best chunk as the snippet. Drop scores under a minimum similarity (tuned with fixtures).
4. **Filters** (type, status, project, tag, date range) are applied to **both** branches by joining the live entity tables (status, project and dates come from the source tables, never from stale index rows).
5. **Merge:** Reciprocal Rank Fusion (`k = 60`) over the two ranked lists, plus small boosts: exact phrase (+), title match (+), recency (a gentle decay), open task over done. Output is paged (20 per page).
6. **Result shape:** `{ type, id, title, emoji, project, snippet, matchKind: "keyword" | "semantic" | "both", score, reasons }`, where `reasons` records which branch matched, the best chunk text, and (for keyword) the matched terms. This metadata is generated by the server, **not by a model**, and is what the UI and the assistant use to explain a result.
7. **Authorization:** every query carries `user_id`; a test proves another person's nearest vector is never returned. The final result rows are re-checked against the live entity tables (deleted, archived and other-owner rows are dropped).

`searchWorkspace(userId, params)` is the single function used by the Search page, ⌘K and the assistant tools (11).

---

## 6. Server contract

| Route / action | Purpose |
|---|---|
| `GET /api/search?q=&type=&status=&project=&tag=&from=&to=&mode=` | Replaces the V1 query path for the Search page; `mode=keyword` forces keyword only. Zod-validated, `requireUser()`, `no-store`. Returns results with `semantic: "used" | "off" | "unavailable"` so the UI can say why only keyword results appear. |
| `POST /api/search/recent` | not needed; recent items are local-only (§2) |
| `setSemanticSearch({ enabled })` (Server Action, `src/actions/settings.ts`) | Toggles the preference; on enable enqueues the backfill, on disable deletes embeddings. |
| `getSearchIndexStatus()` | `{ enabled, documents, indexed, backlog, lastIndexedAt, paused, model }` for Settings. |
| `reindexSearch()` | Re-queues every document (rate-limited, once per hour). |

Existing V1 search pages keep working; `/search` and ⌘K call `searchWorkspace`.

---

## 7. UI

- **Search page and ⌘K:** same layout (V1). Result rows may show a quiet text label for the match kind ("Matches your words" / "Related meaning" / "Both"): plain text, no sparkle icon, no AI badge (DESIGN.md). A **Why this result** disclosure shows the stored reasons: matched terms or the best matching passage, and for semantic matches "Found because its meaning is close to your search." Exact-phrase queries show a "Phrase" label.
- **Exact phrase:** typing quotes works; a small hint under the box: `Use "quotes" to match an exact phrase.`
- **Recent items:** with an empty query, ⌘K and `/search` list **Recent** (the last 8 opened items, local) above recent searches. Items the person cannot open any more are dropped.
- **States:** semantic off (a one-line invitation with a link to Settings, shown once per session), indexing in progress ("Still indexing 38 items. Results may be incomplete."), provider unavailable or offline ("Showing keyword results only."). Nothing blocks the search.
- **Settings → AI → Semantic search:** the opt-in switch with the plain disclosure ("Your notes and tasks are sent to <provider> to build a search index. They are not stored by Dayboard anywhere else. You can turn this off and the index is deleted."), the Gemini free-tier data note when relevant, index status (indexed X of Y, backlog, last indexed, paused reason), **Re-index**.
- **Offline:** keyword search runs on local data (substring over titles and bodies in Dexie, same ranking rules where practical) with the "keyword results only" note; recent items always work.
- Search results link directly to the originating task or note (product §6): tasks open the panel, notes open at the note (and, for a semantic hit inside a long note, with the matched passage highlighted when the editor can find it).

---

## 8. Rules and limits

- **Privacy:** note text goes to the provider only for chunks being embedded and only after opt-in; chunk text is stored in our database (it already holds the notes); logs carry ids and counts, never text.
- **No cross-user data:** per-user filters on every query; tests enforce it.
- **Fast before fancy:** the keyword branch and the vector branch run in parallel; if the vector branch exceeds 800 ms the keyword results are returned and the semantic ones are appended when ready (the UI updates), so search never feels slower than V1.
- **Sizes:** at most 200 chunks per document; documents over the cap index the first 200 chunks.
- **Re-embedding on model change:** `model` mismatch rows are re-embedded by the backfill; searches ignore rows with an old model.
- **Deletion:** deleting an entity or the user removes its documents and chunks (cascade); disabling removes all.

---

## 9. Tests

**Unit**
- Chunker: headings, long paragraphs, overlap, tables and toggles, size caps, title prefixing, empty content.
- Query parser: terms, phrases, unbalanced quotes, filters.
- RRF merge and boosts; minimum-similarity cut; deterministic ordering.
- Mock embedder: concept buckets (authentication ≈ login/OTP), normalised length, determinism.
- Hash-based change detection (only changed chunks re-embedded).

**Integration** (test database with pgvector)
- Index a set of documents with the mock embedder; "authentication problems" finds a note that says "login failures with OTP" without a keyword overlap; "OTP security" finds the related task.
- Hybrid: a phrase query ranks the exact match first; keyword-only and semantic-only hits both appear; `matchKind` correct.
- **Authorization:** user A's query never returns user B's chunks even when B's vector is the nearest; deleted, archived and trashed items are dropped; filters (status, project, tag, dates) apply to both branches.
- Opt-in off: nothing enqueued, nothing sent (the mock records zero calls); on: backfill enqueued; off again: embeddings deleted.
- Provider failure returns keyword results with `semantic: "unavailable"`.
- Daily embedding cap pauses indexing and reports it.
- Worker: index job idempotent; dedupe collapses a burst.

**E2E**
1. Enable semantic search; wait for the index status to complete; a meaning-only query finds the related note; the result links to it; "Why this result" explains.
2. A quoted phrase query; filters narrow results.
3. Recent items appear for an empty query after opening items.
4. Disable: embeddings gone, search still works.
5. Offline: keyword results with the note; recent items work.
6. Semantic off shows the one-time invitation; indexing-in-progress note.
7. Axe, 360px, light and dark.

---

## 10. Definition of done

- [ ] A semantic query finds a related note or task without an exact keyword match, and results link to the item
- [ ] Hybrid ranking keeps keyword search intact; exact phrases, filters and recent items work
- [ ] No result ever includes another person's data (tested), nor trashed or archived items
- [ ] Indexing is opt-in, background, idempotent, capped and visible (status, backlog, re-index); disabling deletes the index
- [ ] The workspace stays fully useful with the provider down, the feature off, or the device offline
- [ ] "Why this result" reasons are server-generated facts, usable by the assistant
- [ ] CI runs with the mock embedder and a pgvector Postgres; no paid calls
- [ ] ADR 0011 written before building (provider, dimension, deviation from table names)
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/semantic-search_v2.md` written and indexed

---

## 11. Out of scope (V2)

Search over file contents or voice transcripts; cross-encoder re-ranking; query rewriting by an LLM; per-language analyzers and stemming; synced recent items across devices; saved searches; search suggestions as you type from the vector index.
