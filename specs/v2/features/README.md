# V2 Feature Specs

Each file in this folder is one buildable feature: a technical breakdown of what to build, drawn from the top-level V2 specs (`../01-product-spec.md` is the source of truth for behaviour). They follow the same structure as the V1 feature docs in `../../v1/features/`.

Build them in order. Each feature leaves the app runnable and depends only on features before it (plus V1).

| # | Feature | Covers (product spec §) | Depends on |
| --- | --- | --- | --- |
| 01 | [Editor Blocks & Lists](01-editor-blocks-and-lists.md) | Slash menu, block handles, tables, toggle lists and headings, callouts, table of contents, nested list markers (§18 except images/bookmarks, §19) | V1 |
| 02 | [Clipboard Fidelity](02-clipboard-fidelity.md) | Copy out and paste in, Slack/Notion/Google Docs/Word/VS Code, Copy note, plain paste (§15) | V1; 01 (soft: new blocks) |
| 03 | [PWA Shell & Install](03-pwa-shell-and-install.md) | Service worker, manifest and icons, install experience, offline shell, update prompt (§4, goal 1) | V1 |
| 04 | [Local Persistence & Offline Editing](04-local-persistence-and-offline.md) | Dexie store, repositories, offline task/todo/note/project edits, offline routing (§4, §5, goal 2) | 03 |
| 05 | [Sync Engine](05-sync-engine.md) | Operation queue, push/pull, idempotency, conflicts, sync status and diagnostics (§5, goal 3) | 04 |
| 06 | [Multiple Views](06-multiple-views.md) | Saved views: list, table, board, calendar, gallery; filters, sorts, groups (§17, goal 14) | 04, 05 |
| 07 | [Nested Notes, Links & Sidebar Tree](07-nested-notes-links-sidebar-tree.md) | Sub-notes, note links, backlinks, breadcrumbs, sidebar tree, Tree view, cascades (§16, goal 13) | 01, 04, 05, 06 |
| 08 | [Background Worker & Jobs](08-background-worker-and-jobs.md) | Jobs table, worker process, retries, scheduler, heartbeat (§12 groundwork, tech §12) | V1 |
| 09 | [Files, Attachments & Bookmarks](09-files-attachments-and-bookmarks.md) | Storage service, uploads, secure downloads, image and file blocks, bookmark cards (§9, §18.6) | 01, 05, 08 |
| 10 | [Semantic Search](10-semantic-search.md) | pgvector, embeddings, hybrid ranking, exact phrase, recent items, filters (§6, goal 4) | 05, 08 |
| 11 | [AI Workspace Assistant](11-ai-workspace-assistant.md) | Multi-turn, grounded, tool-based, proposals with confirmation, related items (§7, goal 5) | 10 |
| 12 | [Google Calendar](12-google-calendar.md) | OAuth, read events, Today and planning integration, time blocks, create events (§8, goal 6) | 05, 08 |
| 13 | [Voice Capture](13-voice-capture.md) | Record, transcribe, parse, review, create (§10, goal 8) | 05, 08, 09 |
| 14 | [Push Notifications & Reminders](14-push-notifications-and-reminders.md) | Web Push, reminders, preferences by category, devices (§12, goal 10) | 03, 05, 08 |
| 15 | [AI Weekly Review](15-ai-weekly-review.md) | Facts vs suggestions, carry-forward, schedule, history (§11, goal 9) | 08, 11, 12, 14 (calendar load and the "ready" notification are optional inputs) |
| 16 | [Production Deployment (V2)](16-production-deployment.md) | Docker with worker, storage, pgvector, CI/CD, backups, rollback, free-hosting profile (goal 11) | all (starts early, see note) |

**Note on 16:** as with V1 feature 06, deployment is not left to the end. Start the worker container and the pgvector database image during 08 and 10, extend CI when 03 lands, and finish CD, backups and rollback after 15. V1 feature 06 is still unfinished; 16 absorbs what it left.

**Note on order versus `../05-project-plan.md`:** the plan lists phases (PWA, local, sync, files, search, AI, calendar, voice, push, review, worker). These docs keep that order except that the **worker (08) comes before files and search**, because embedding, cleanup and transcription jobs need it. The editor work (01–02) has no dependency on sync, so it can run in parallel with 03–05.

## Coverage of the product spec

Every requirement in `../01-product-spec.md` lands in a feature:

| Product spec | Feature |
| --- | --- |
| §2 goal 1, §4 PWA (manifest, install UI, offline shell, update prompt, service worker) | 03 |
| §4 offline task/note CRUD, completion and rescheduling | 04 |
| §4 sync queue, status indicator, retry, conflicts; §5 operation records, diagnostics | 05 |
| §4 push notifications; §12 smart notifications | 14 (with 03's service worker) |
| §6 semantic search, exact phrase, recent items, filters | 10 |
| §7 AI workspace assistant, citations, confirmation, related items, "why retrieved" | 11 (retrieval from 10) |
| §8 Google Calendar | 12 |
| §9 files and attachments, storage interface | 09 |
| §10 voice capture | 13 |
| §11 AI weekly review | 15 |
| §12 notification preferences by category | 14 |
| §13 UX principles | applied in every feature (see conventions) |
| §15 clipboard fidelity | 02 |
| §16 nested notes, note links, backlinks, sidebar tree, cascades | 07 |
| §17 multiple views | 06 (Tree view slot filled by 07; calendar overlay by 12) |
| §18 editor blocks: slash menu, tables, toggles, callouts, table of contents | 01 |
| §18.6 images, files, bookmark cards | 09 |
| §18.8 task descriptions get every block | 01 (surface rules), 07, 09 |
| §19 nested list numbering | 01 |
| Goal 11 Docker-first deployment, worker, backups, rollback | 08 (local worker), 16 |
| §3 non-goals | respected; each doc ends with its own out-of-scope list |
| §14 success criteria | see the table below; the full list is re-run in 16 |

### Success criteria (product spec §14) by feature

| # | A daily user can… | Verified in |
| --- | --- | --- |
| 1 | Install the app | 03 |
| 2 | Open it without a network connection | 03, 04 |
| 3, 4 | Create and edit a task and a note (offline too) | 04 |
| 5 | Reconnect and see changes synchronize | 05 |
| 6 | Search semantically for older information | 10 |
| 7 | Connect a calendar | 12 |
| 8 | Attach a file | 09 |
| 9 | Speak a quick capture and convert it into an item | 13 |
| 10 | Receive a meaningful weekly AI review | 15 |
| 11 | Copy a section of a note into Slack, Notion or Google Docs and paste lists back | 02 (with 01 for the blocks) |
| 12 | Create sub-notes, link with `@`, see backlinks, find the note in the sidebar tree | 07 |
| 13 | Use a board, table, notes board or tree, and tasks on a calendar | 06 (Tree view from 07) |
| 14 | Insert a table, toggle, callout, table of contents and bookmark card with `/` | 01, 09 (bookmark) |
| 15 | See `1.` then `a.` then `i.` in a nested numbered list | 01 |

## How to use these docs

- The product spec stays the source of truth for behaviour. The technical (`../02-technical-spec.md`), UI/UX (`../03-ui-ux-spec.md`) and plan (`../05-project-plan.md`) specs have **not yet been updated** for goals 12 to 16 (see product spec §20). Where a feature doc here is more detailed or newer, **the feature doc wins** for that feature, and the top-level spec should be updated to match. Do not silently diverge.
- Every feature doc follows: Scope → Data model → Server contract → Behaviour and UI → Rules → Tests → Definition of done → Out of scope. `../Agent.md` and the V1 definition of done (`../../v1/Agent.md` §24) apply on top of each checklist.
- When a feature is built, write `agent_docs/{feature-name}_v2.md` and add its index line. Add an "As built" section to the feature doc with every deviation, as the V1 docs do.
- ADRs are required **before** building anything that departs from the stack in `CLAUDE.md` or the V2 `Agent.md`. The ones these docs already expect are listed below.

## Cross-cutting conventions (apply to every V2 feature)

**Offline-first rule** (`../Agent.md` §4). A primary user action on tasks, todos, notes, projects, tags or views does four things, in order: update local state immediately, enqueue a durable operation, try to sync, reconcile the server's answer. Nothing is ever dropped silently. Features that need the network (AI, search index, calendar, uploads finalising) say so, keep working in a reduced form offline, and never show a technical error for being offline.

**Identity and ids.** Ids stay UUID v7, now **generated on the client** so records can be created offline. The server accepts a client-supplied id on create, checks it is a well-formed v7, and rejects it if it already exists for someone else. Every device has a stable `device_id` (UUID v7 kept in IndexedDB), sent with every operation.

**Syncable entities.** Tasks, todos, notes, projects, tags, links and views carry `version` (integer, bumped by the server on every write), `updated_at`, `deleted_at` (soft delete, kept as a tombstone so deletions sync) and `last_modified_by_device_id`. Introduced in 05; features before it must not fight this shape.

**Idempotency.** Every write from a device has an operation id. Applying the same operation twice has the same effect as once.

**Ownership.** Every query and mutation is scoped to the signed-in user on the server. Hiding a button is not access control. New tables carry `user_id` with `ON DELETE CASCADE`. Ids from the client are always re-checked against the session user.

**AI rules** (`../Agent.md` §5). All AI goes through the provider adapter and its mock. Output is validated with Zod. Anything that mutates data is a proposal until the person confirms, and an AI-triggered mutation writes an audit record. Do not log note text, transcripts or prompts. CI never calls a paid provider.

**Providers behind adapters.** Calendar, storage, AI (including embeddings and transcription), push and link fetching each have an interface and a test double. Provider SDKs are imported in one place only.

**Jobs.** Anything slow, scheduled or retryable runs as a job on the worker (08), never inside a request.

**Validation and errors.** A Zod schema per action input and per operation payload in `src/lib/validations/`. Typed error codes in `{ error: { code, message } }`. New codes (`APP_OUTDATED`, `CONFLICT`, `STORAGE_UNAVAILABLE`, `QUOTA_EXCEEDED`, `UNSUPPORTED_FILE_TYPE`, `CALENDAR_NEEDS_RECONNECT`) are added to the error model as features need them.

**Design and accessibility.** `DESIGN.md` rules still apply (one accent, hairlines, red is rare, weights 400 and 600, colour never the only signal, 44px touch targets, reduced motion). Every drag-and-drop action has a keyboard and touch alternative. New screens work at 360px and in light and dark.

**Tests.** Vitest unit tests for pure logic; integration tests (real route handlers, real database, mock providers); Playwright for flows, using `context.setOffline()` for offline cases and the mock providers for AI, calendar, storage and push. A browser feature that automation cannot drive (install prompt, real push) gets a written manual checklist in the feature's definition of done.

**New packages** are allowed only as the V2 `Agent.md` and `CLAUDE.md` list them (Serwist, Dexie, TanStack Query, pgvector, an S3 client, Web Push) or after an ADR. Each feature lists what it adds. Before adding one: is it required, does something we have already do the job, does it work with the pinned Next.js and React, and does it complicate deployment?

## ADRs these docs expect (write before building)

| Number (next free) | Decision | Feature |
| --- | --- | --- |
| 0006 | Offline routing model (client-rendered local app versus cached RSC) | 04 |
| 0007 | Sync protocol: change log and pull cursor, conflict records | 05 |
| 0008 | Drag and drop library | 06 |
| 0009 | Worker runtime and "tick mode" for serverless hosts | 08 |
| 0010 | Object storage client (S3-compatible) and file type policy | 09 |
| 0011 | Embedding provider and vector dimension (Anthropic has no embeddings; `@ai-sdk/google` is already installed) | 10 |
| 0012 | Transcription provider | 13 |
| 0013 | Web Push library and VAPID handling | 14 |
| 0014 | Service worker build (Serwist with Next 16, or a bundled `sw.ts`) | 03 |

## Suggested slicing for a first release

If V2 must ship in stages: **A** = 01, 02 (editor, no backend change); **B** = 03, 04, 05 (offline); **C** = 06, 07 (views, nesting); **D** = 08, 09, 10, 11 (worker, files, search, assistant); **E** = 12, 13, 14, 15 (calendar, voice, push, review); **F** = 16 throughout. A can ship before B.
