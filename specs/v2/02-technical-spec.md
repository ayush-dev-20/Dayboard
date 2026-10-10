# V2 Technical Specification — PWA, Sync, Search, Files, and AI

## 1. Preserve the V1 baseline

Keep:

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- shadcn/ui
- Tiptap
- PostgreSQL
- Drizzle ORM
- Better Auth
- Zod
- Docker Compose
- Caddy
- GitHub Actions

V2 is an evolution of the modular monolith, not a rewrite.

## 2. PWA architecture

Recommended PWA layer:

- Serwist with its Next.js integration
- service worker
- Web App Manifest
- IndexedDB-backed local persistence

Use a browser storage abstraction rather than calling IndexedDB throughout the UI.

Suggested layers:

```text
UI
 ↓
Application Commands
 ↓
Local Repository
 ↓
Sync Queue
 ↓
HTTP API / Server Actions
 ↓
PostgreSQL
```

The service worker handles app-shell caching, safe static caching, and push events. Do not cache authenticated API responses indiscriminately.

## 3. Client-side data layer

Recommended approach:

- TanStack Query for server-state synchronization and cache invalidation
- Dexie for IndexedDB abstraction
- domain-specific repository functions

Do not allow components to call IndexedDB tables directly.

## 4. Sync protocol

Every syncable entity should expose:

- id
- version number or revision
- updatedAt
- deletedAt where relevant
- lastModifiedByDeviceId

Server mutation examples:

- createEntity
- updateEntity
- deleteEntity
- reorderEntity
- completeTask

The server should use optimistic concurrency for edits where practical.

### Conflict strategy

V2 should use a predictable field-aware strategy:

- scalar fields: last-write-wins using server-normalized timestamps
- ordered block content: create a conflict record if concurrent edits touch the same note version
- deleted vs edited: preserve the edited copy in a recoverable conflict state instead of silently destroying content

Do not claim to provide CRDT-grade collaboration in V2.

## 5. Semantic search architecture

Use PostgreSQL + pgvector.

Suggested tables:

- embeddings
- embedding_chunks
- search_documents

Store embeddings for:

- note blocks/chunks
- task title + description
- project descriptions

Use a background job for embedding generation.

Search pipeline:

```text
User query
  ↓
Normalize
  ↓
Keyword search ─────┐
                    ├──> Rank / merge ──> Results
Embedding search ───┘
```

Do not replace keyword search with vectors. Hybrid retrieval is the V2 default.

## 6. AI architecture

Create a provider abstraction:

```ts
interface AiProvider {
  generateStructured<T>(input: AiInput, schema: ZodSchema<T>): Promise<T>
  streamText(input: AiInput): AsyncIterable<string>
  embed(input: string): Promise<number[]>
  transcribe?(audio: Blob | Buffer): Promise<Transcript>
}
```

AI features should be represented as application commands, not arbitrary database access.

Examples:

- searchWorkspace
- summarizeNote
- extractTasks
- suggestDailyPlan
- draftWeeklyReview
- voiceCaptureParse
- askAboutSelection (answer a question about selected text, from the selection and the text around it; no other tools)
- editSelection with a custom instruction (rewrite the selection only)

Every AI tool must enforce the authenticated user's workspace scope. When the person drags a note, task or project onto the chat button, the assistant request carries up to 5 `{ type, id }` contexts: each is re-checked for ownership on the server and the tools are limited to those items (a project stands for itself and its tasks and notes).

## 7. AI grounding and citations

The assistant should receive only the minimum relevant retrieved content.

Every retrieved chunk should carry:

- source entity id
- source type
- title
- link
- relevance score

The model response should return source references that the UI renders as clickable citations.

## 8. Google Calendar integration

Use OAuth with least-privilege scopes.

Store:

- provider account id
- encrypted refresh token
- token expiry metadata
- selected calendars
- last sync timestamp

Never store raw access tokens in browser local storage.

Implement a calendar adapter:

```ts
interface CalendarProvider {
  listCalendars(): Promise<Calendar[]>
  listEvents(range: DateRange): Promise<CalendarEvent[]>
  createEvent(input: CreateEventInput): Promise<CalendarEvent>
}
```

Keep the provider-specific implementation isolated from domain logic.

## 9. File storage

Recommended V2 default: Backblaze B2 (always-free 10 GB, S3-compatible with presigned URLs), chosen in feature 09 and ADR 0010. Cloudflare R2 or any other S3-compatible object store works through the same adapter by changing environment values.

Use presigned upload/download URLs where appropriate.

Flow:

```text
Browser -> request upload intent -> Next.js
Next.js -> authorized signed URL
Browser -> object storage
Browser -> finalize upload -> Next.js
Next.js -> metadata in PostgreSQL
```

Never expose private bucket credentials to the browser.

## 10. Audio pipeline

Do not stream raw audio through the main database.

Flow:

`Browser recorder -> temporary upload -> transcription provider -> structured capture -> user confirmation -> persisted task/note`

Retain audio only if the user explicitly chooses to keep the recording.

## 11. Push notifications

Use Web Push with a service worker.

Store subscriptions per user/device/browser.

Model:

- id
- userId
- deviceId
- endpoint
- publicKey/auth data
- createdAt
- lastSeenAt

Protect subscription endpoints against CSRF and unauthorized cross-user writes.

## 12. Background jobs

V2 needs asynchronous work for:

- embeddings
- weekly reviews
- transcription
- notification delivery
- cleanup
- calendar sync

For a modest deployment, begin with a database-backed job table plus a separate worker process in Docker Compose.

Only split into a separate queue product when metrics justify it.

Suggested runtime topology:

```text
Caddy
  |
Next.js Web
  |
PostgreSQL <---- Worker
  |
Object Storage
```

## 13. Security requirements

- Encrypt provider refresh tokens at rest.
- Keep object storage private by default.
- Verify ownership for every file, embedding, sync, and AI retrieval.
- Rate limit AI endpoints.
- Cap audio/file sizes.
- Log model/provider failures without logging sensitive note contents.
- Redact secrets from logs.
- Add audit records for AI-triggered mutations.

## 14. Observability

Track:

- sync success/failure rate
- average sync latency
- queue depth
- AI latency
- AI failure rate
- embedding backlog
- transcription failure rate
- file upload failure rate
- push delivery attempts

Add correlation/request ids across web requests and worker jobs.
