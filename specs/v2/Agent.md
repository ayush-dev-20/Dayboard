# Agent.md — V2 Coding Agent Instructions

## 1. Read first

Read all V2 spec files before making changes:

- `01-product-spec.md`
- `02-technical-spec.md`
- `03-ui-ux-spec.md`
- `04-devops-deployment-spec.md`
- `05-project-plan.md`

Also treat the V1 repository as the baseline. Prefer evolution over rewrites.

## 2. V2 priorities

1. Preserve V1 functionality.
2. Add offline capability safely.
3. Keep data synchronization deterministic.
4. Ground AI in authenticated workspace data.
5. Keep provider integrations behind adapters.
6. Keep deployment understandable.

## 3. Hard constraints

Keep the V1 stack and add:

- Serwist for PWA
- Dexie for IndexedDB abstraction
- TanStack Query for server-state/cache synchronization
- pgvector for semantic retrieval
- a background worker for asynchronous jobs
- S3-compatible object storage
- Web Push for notifications

Do not introduce microservices beyond the worker unless an explicit performance or isolation requirement is documented.

## 4. Offline rules

Never assume the network exists.

A primary task/note action should:

1. update local state immediately,
2. enqueue a durable sync operation,
3. attempt synchronization,
4. reconcile the server response.

Never discard an offline operation silently.

## 5. AI safety/product rules

AI must be workspace-scoped.

AI retrieval and tool execution must use server-side authorization.

AI may suggest data changes, but mutation requires explicit confirmation unless the spec explicitly defines an automatic low-risk operation.

Do not log full private notes or transcripts.

## 6. Integration rules

Google Calendar, object storage, and AI providers must use adapter interfaces.

Provider-specific code belongs in an infrastructure/integration layer.

Do not spread provider SDK calls through UI components.

## 7. Testing rules

Add tests for:

- offline mutation queueing
- retry/idempotency
- reconnect synchronization
- conflict recovery
- semantic search authorization
- AI workspace scoping
- file authorization
- calendar token handling
- push subscription ownership

Playwright must cover at least:

- install/online core shell where browser automation supports it
- offline create task
- reconnect and sync
- semantic search
- AI answer with source links

## 8. Delivery discipline

Implement one vertical slice at a time.

Keep the application runnable after each phase.

Do not bundle unrelated refactors into feature commits.

When a technical choice differs from this spec, document why in `docs/decisions/` before proceeding.
