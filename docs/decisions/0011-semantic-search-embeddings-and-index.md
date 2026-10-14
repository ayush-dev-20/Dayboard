# 0011. Semantic search: Gemini embeddings, pgvector, and a scheduled indexing scan

**Status:** Proposed. It becomes Accepted after one real embedding call has been made with the owner's key (see Consequences).
**Date:** 2026-10-14
**Phase:** V2

## Context

V2 feature 10 (`specs/v2/features/10-semantic-search.md`) adds search by meaning on top of the keyword search. It needs somewhere to keep vectors, a model that turns text into vectors, and a way to keep the index current. Anthropic offers no embedding model; `@ai-sdk/google` is already a dependency and has a free tier. Production is Vercel + Neon, where jobs run only on a five-minute tick (ADR 0009). The sync change log (feature 05) covers tasks only, and the task, todo, note and project mutations belong to other features.

## Decision

- **Vectors live in PostgreSQL with pgvector** (`vector(768)`, an HNSW index with cosine distance). No second database.
- **Model:** `gemini-embedding-001` through `@ai-sdk/google` (`embedMany`), asked for 768 dimensions and a document or query task type. `AI_EMBEDDING_MODEL` can name another model. Only the Google provider and the mock can embed; with Anthropic the search stays keyword-only. The dimension and model are stored with every vector (`model` = `gemini-embedding-001@768`), so a change makes old rows visible and they are re-embedded gradually.
- **Tables:** `search_documents` (one row per indexed item: hash, the item's `updated_at` it was built from, status) and `embedding_chunks` (the pieces, with the text, the vector and the model). This differs from the technical spec's single `embeddings` table. The full text of an item is **not** copied; only the pieces are. A small `embedding_usage_days` counter holds the daily cap (`EMBED_DAILY_LIMIT`, default 2,000 pieces per person), because replaced pieces are deleted and would not be counted otherwise.
- **Indexing is a scan, not a hook.** A schedule runs `embedding.scan` every five minutes. It queues `embedding.scan_user` for each person who opted in, which compares each item's `updated_at` with the index, removes entries for items that are gone, in Trash or archived, and queues up to 200 `embedding.index` jobs. An edit that changes no text (a status or date) costs no model call, because the content hash is compared first. Nothing in the task, todo, note or project mutations changes.
- **Two usage types.** Indexing is recorded as `EMBED` and does not count toward a person's daily AI actions; a search query's embedding is `EMBED_QUERY` and does, against the normal limits.
- **Opt-in, default off** (`user_preferences.semantic_search_enabled`), because indexing sends every note and task to the provider. Turning it off deletes the whole index.
- **Searched on the Search page, not as you type in ⌘K.** Each semantic search costs one AI action, and ⌘K searches on every keystroke.
- **Hybrid ranking** is Reciprocal Rank Fusion of the keyword and meaning rankings, per result type (the Search page is grouped by type), plus small boosts. A meaning branch that is off, over a limit, failing or slower than two seconds is skipped and the keyword results are returned with a note.
- **Recently opened items** are kept in `localStorage` (ids and types only) and resolved by the server, which keeps only items that exist and belong to the person.

## Alternatives

- **Hooks in every mutation, or the sync change log.** Faster freshness, but the change log covers tasks only, and many files that belong to other features would change. Rejected for a scan that also backfills and repairs itself.
- **A separate vector service (Pinecone, Qdrant).** More capable, but another paid service, another secret, and no shared transaction with the item tables. Rejected.
- **Keep the full body in `search_documents`.** Simpler queries, but it doubles the text stored on a 0.5 GB free database. Rejected.
- **Embedding queries as you type in ⌘K.** Would spend the person's AI actions per keystroke. Rejected.

## Consequences

- **pgvector is a prerequisite everywhere the migration runs.** Local Postgres (Homebrew `pgvector`), the Docker `db` image (`pgvector/pgvector:pg17`, changed in `docker-compose.yml`, not run here), CI, and Neon (enable the extension before migration `0014`; Neon documents support, not checked on the project).
- Meaning results lag the item by up to one scan interval plus the job run: about ten minutes on the Vercel tick profile. Keyword results are always current.
- **Not yet verified:** a real call to the embedding model. The mock is used in every test. This ADR stays Proposed until `gemini-embedding-001` with 768 dimensions has been called once with the owner's key and the ranking looked at on real notes.
- The similarity cutoff (`MIN_SIMILARITY` = 0.35) is tuned against the mock only and must be checked against the real model.
- A forced re-index re-embeds everything and uses the daily cap.
