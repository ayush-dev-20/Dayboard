# Feature: Semantic search

**Phase:** V2 (feature 10)
**Status:** In progress. Indexing, hybrid search on the Search page, recent items and the Settings switch are built and tested with the **mock embedder**. **Not run against the real Gemini model**, and not applied to the dev database or Neon.
**Date:** 2026-10-14

## What was built

- **Index** (migration `0014`, `src/db/schema/search.ts`): `search_documents`, `embedding_chunks` (`vector(768)`, HNSW cosine index), `embedding_usage_days` (the daily cap counter), `user_preferences.semantic_search_enabled` (default off), two `ai_feature` values (`EMBED`, `EMBED_QUERY`), `todos` and `projects` indexes on `(user_id, updated_at)` for the scan, and the `embedding.scan` schedule (`every 5m`). The migration starts with `CREATE EXTENSION IF NOT EXISTS vector`.
- **A scan, not hooks** (`src/lib/search/semantic/handlers.ts`): `embedding.scan` lists people who opted in (and have AI on), `embedding.scan_user` removes index entries for items that are gone, in Trash or archived and queues up to 200 `embedding.index` jobs for new or changed items, and `embedding.index` (`indexer.ts`) loads the item fresh, compares hashes, embeds only changed pieces and writes in one transaction. No task, todo, note or project mutation was changed. Handlers are registered from `ensureBuiltinHandlers`.
- **Pure logic** (`src/lib/search/`): `parse.ts` (words and "quoted phrases"), `chunk.ts` (notes by heading and paragraph with the title and heading in front of every piece; one piece for a task, todo or project), `merge.ts` (Reciprocal Rank Fusion, boosts, minimum similarity), `recent-items.ts` (the opened-items store).
- **Embeddings in the AI layer:** `embed()` on `AIProvider`; the mock (`mock-embed.ts`, a small table of related words) and the Gemini adapter (`sdk.ts`, `embedMany`); `embedTexts()` in `src/lib/ai/index.ts` (batches of 50, one retry, one usage row per batch).
- **Search** (`src/lib/search/semantic/hybrid.ts`): keyword search always runs; with the feature on, the query is embedded, the nearest pieces are found, and both rankings are merged **per result type**. A phrase in quotes is the keyword search and also filters the meaning results. Any trouble with the meaning side returns keyword results with `semantic: "unavailable"`. `searchByIds` in `src/db/queries/search.ts` reuses the V1 filters and Trash rule for items found by meaning.
- **UI:** the Search page shows "Matches your words / Related meaning / Matches words and meaning / Phrase" and a "Why this result" disclosure, a hint about quotes, and notes for off and unavailable. Settings → AI has the switch, the plain disclosure, index status, Start now and Re-index. Opened tasks, notes and projects are remembered (`RecordOpened`, the task panel and page) and ⌘K lists them first through `GET /api/search?recent=1&open=…`.

## Why

See ADR 0011 (`docs/decisions/0011-semantic-search-embeddings-and-index.md`). The scan was chosen because only tasks write the sync change log and the mutation files belong to other features.

## What was deferred

- **A real model call.** The embedding model name `gemini-embedding-001` and the 768 size have never been called. ADR 0011 stays Proposed until one real call is made and the similarity cutoff (`MIN_SIMILARITY` = 0.35, tuned on the mock) is checked on real notes.
- **The dev database and Neon** still need migration `0014` and the pgvector extension (ask first for Neon).
- **Re-index once per hour** and **Start now once per minute** limits: a scan already waiting is reused, but no separate time limit exists.
- **Keyword results first, meaning appended later** (spec §8): not built. The meaning side has a two-second budget (`SEMANTIC_BUDGET_MS`) and is skipped when it runs over.
- **⌘K as you type is keyword only.** Each semantic search costs one AI action, so it runs on the Search page. ⌘K still shows opened items first.
- **Recent items on the `/search` page** with an empty query: only ⌘K lists them.
- Phrases beyond the first are used as a filter on the meaning side only; the keyword side searches the first phrase.
- No `pnpm check:bundle`, visual baselines or axe run for the new UI.

## Deviations from the spec

- **Two usage types** (`EMBED` background, `EMBED_QUERY` search) instead of one. Indexing is excluded from the person's daily AI action count (`src/lib/ai/usage.ts`), otherwise a backfill would use the 100-a-day limit.
- **`embedding_usage_days`** (new) holds the daily cap.
- **Actions** are in `src/actions/semantic-search.ts`, not `settings.ts`. `GET /api/search?recent=1` also returns `kept` (the opened refs that still exist) so the browser can prune its list.
- **Fusion is per result type**, because the Search page is grouped by type.

## Related files

- `src/lib/search/semantic/` (`store.ts` queries and cap, `indexer.ts`, `handlers.ts`, `hybrid.ts`, `status.ts`), `src/lib/search/{parse,chunk,merge,recent-items}.ts`.
- `src/lib/ai/embedding.ts`, `src/lib/ai/providers/mock-embed.ts`, `embed` in `provider.ts`, `sdk.ts`, `mock.ts`, `embedTexts` in `index.ts`.
- `src/actions/semantic-search.ts`, `src/components/settings/semantic-search-settings.tsx`, `src/components/search/{search-result,record-opened}.tsx`, `src/app/(app)/search/page.tsx`.
- Tests: `tests/unit/semantic-pure.test.ts`, `recent-items.test.ts`; `tests/integration/semantic-search.test.ts` (21 cases on the real database with pgvector); `e2e/semantic-search.spec.ts`.

## Hand-off notes

- **pgvector must be installed** wherever migrations run. Locally it is Homebrew `pgvector` (installed 2026-10-14, 0.8.7). Migration `0014` was applied to `dayboard_test` only.
- **E2E runs jobs through tick mode:** `playwright.config.ts` now sets `JOBS_TICK_SECRET`; the spec calls `POST /api/jobs/tick`.
- **Mock markers:** `[mock:error]` in an item's text or in a query makes the embedder fail. `mockEmbedStats` (in `mock-embed.ts`) counts calls so tests can prove "no model call".
- **`updated_at` precision:** the scan compares `date_trunc('milliseconds', updated_at)` with the stored copy, because JavaScript dates have milliseconds and the database microseconds. Any code that stores `source_updated_at` must use the item's value as read from the database.
- A forced re-index clears stored hashes and chunks, then re-embeds within the daily cap.
- Related: `background-worker-and-jobs_v2.md` (jobs, tick), `sync-engine_v2.md` (this feature does not read the change log), `ai-workspace-assistant_v2.md` (its `searchItems` and `findRelatedItems` are the seam for hybrid search; **not switched over yet**), ADR 0009 and 0011.
