# V1 Technical Specification — Next.js + PostgreSQL + Docker

## 1. Technology baseline

Use the following architecture unless a documented technical blocker requires a change.

### Application

- Next.js 16.x
- App Router
- React 19.x
- TypeScript
- Node.js 24 LTS runtime
- pnpm package manager

Next.js 16.3 is an active release line as of September 2026. Keep the exact patch version pinned by the package manager lockfile rather than hard-coding assumptions in this document.

### Styling and UI

- Tailwind CSS v4
- shadcn/ui
- Lucide React
- Motion for React, used sparingly
- next-themes

Tailwind CSS v4 and shadcn/ui should be the foundation of the design system. Do not introduce a second component library.

### Rich text

- Tiptap
- ProseMirror via Tiptap

Tiptap must only initialize on the client where required by SSR behavior.

### Backend/data

- Next.js Server Components for server-side reads
- Next.js Server Functions / Server Actions for mutations where appropriate
- Route Handlers for streaming/AI endpoints and APIs that need HTTP semantics
- PostgreSQL
- Drizzle ORM
- Drizzle Kit for migrations

### Authentication

- Better Auth (chosen over Clerk and Auth.js; rationale in `features/01-foundation-and-auth.md` §2)
- PostgreSQL-backed sessions/data via the Drizzle adapter
- Sign-in methods: email/password, Google, GitHub, magic link
- Resend for transactional email (verification, password reset, magic link), behind a replaceable `EmailSender` interface

### Validation

- Zod for server-side validation and structured AI output validation

### Testing

- Vitest for unit/domain tests
- Playwright for critical browser E2E tests

### DevOps

- Docker
- Docker Compose
- Caddy reverse proxy
- GitHub Actions
- GitHub Container Registry (GHCR) or another OCI-compatible registry

### Quality

- ESLint
- Prettier
- Husky
- lint-staged

---

## 2. Architecture philosophy

Use a modular monolith.

Do not create separate microservices for V1.

```text
Browser
   |
   v
Caddy (HTTPS / reverse proxy)
   |
   v
Next.js container
   |
   +---- Better Auth
   +---- Server Functions / Route Handlers
   +---- AI service adapter
   |
   v
PostgreSQL container / hosted PostgreSQL
```

The modular boundaries should still make future extraction possible.

---

## 3. Rendering strategy

Prefer Server Components by default.

Use Client Components only when needed for:

- Editor interaction
- Drag/drop
- Menus/dialog state
- Keyboard shortcuts
- optimistic local UI
- browser APIs
- animations
- interactive AI streaming UI

Do not turn whole route trees into Client Components unnecessarily.

For mutations, use Server Functions/Actions where the workflow fits them. Always re-check authentication and authorization inside the server-side mutation function; UI-level hiding is not a security control.

Use Route Handlers when:

- streaming a response
- returning a conventional HTTP API response
- integrating an external webhook
- health endpoints
- an endpoint needs independent request/response control

---

## 4. Suggested source structure

```text
src/
  app/
    (marketing)/
    (auth)/
    (app)/
      today/
      tasks/
      notes/
      projects/
      inbox/
      search/
      trash/
      settings/
    api/
      auth/[...all]/
      ai/
      health/
  components/
    ui/
    layout/
    task/
    note/
    project/
    inbox/
    ai/
    search/
  db/
    schema/
    queries/
    mutations/
    client.ts
  lib/
    auth.ts
    auth-client.ts
    ai/
    permissions.ts
    search/
    validations/
    dates/
    errors/
    env.ts
  actions/
    tasks.ts
    notes.ts
    projects.ts
    inbox.ts
    tags.ts
  hooks/
  types/
  styles/

scripts/
  migrate.ts
  seed.ts

drizzle/
  migrations/

e2e/

tests/
```

The exact folder names may be refined by Claude during implementation, but the separation of concerns must remain.

---

## 5. Database model

Use PostgreSQL.

Primary tables:

- Better Auth tables: `user`, `session`, `account`, `verification`, `rate_limit`
- user_preferences
- projects
- tasks
- todos
- task_tags
- notes
- note_tags
- task_notes
- inbox_items
- tags
- ai_usage
- ai_daily_suggestions

Full column definitions live in the feature docs under `features/`. All tables use UUIDs, and Better Auth is configured to generate UUIDs too.

### Task constraints

- `tasks.user_id` required
- `tasks.project_id` nullable but must belong to same user
- `tasks.parent_task_id` nullable and same-user only
- completed task has `completed_at`
- deleted task has `deleted_at`

### Note constraints

- `notes.user_id` required
- `notes.content_json` JSONB
- `notes.content_text` text projection
- project relationship optional
- deleted note has `deleted_at`

### Project constraints

- `projects.user_id` required
- project names should be indexed for user-scoped lookup

### Tag constraints

Tag uniqueness should be scoped to the user, e.g. `(user_id, normalized_name)` unique.

### Relationship tables

`task_notes`:

- task_id
- note_id
- user_id
- created_at

The `user_id` on relationship rows is intentional. It simplifies defense-in-depth and auditing.

---

## 6. Database indexes

At minimum:

### tasks

- `(user_id, status)`
- `(user_id, due_at)`
- `(user_id, updated_at)`
- `(user_id, deleted_at)`
- `(user_id, project_id)`

### notes

- `(user_id, updated_at)`
- `(user_id, deleted_at)`
- `(user_id, project_id)`

### inbox

- `(user_id, status, created_at)`

### tags

- `(user_id, normalized_name)` unique

Search can start with `ILIKE` against bounded fields. Optimize with PostgreSQL full-text indexes if needed after profiling.

Do not introduce pgvector in V1.

---

## 7. Authorization model

Every data access path must enforce user ownership.

Never rely only on route-level protection.

For every query/mutation:

1. Resolve authenticated user.
2. Validate request input with Zod where applicable.
3. Query/update using both resource ID and authenticated user ID.
4. For linked resources, verify both resources belong to the same user.
5. Return safe errors without leaking existence of another user's resources.

Example principle:

```text
UPDATE tasks
SET ...
WHERE id = :taskId
AND user_id = :currentUserId
AND deleted_at IS NULL;
```

---

## 8. Input validation

Use Zod schemas for:

- Auth/profile inputs where needed
- Task create/update
- Note metadata update
- Project create/update
- Tag create/update
- Inbox conversion
- Search filters
- AI request payloads
- AI structured outputs

Validate on the server even if client validation exists.

Never trust client-provided `userId`.

---

## 9. API / server contract

V1 is primarily a server-first Next.js application. Avoid creating a REST API for every internal action.

### Server Functions / Actions

Use actions for:

- create/update/complete task
- create/update note metadata
- create/update project
- create/update tags
- convert inbox item
- delete/restore items

### Route Handlers

Use Route Handlers for:

- `GET /api/health`
- AI streaming endpoints
- Better Auth route
- external webhooks if any are introduced

Return predictable error shapes.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The task title is required."
  }
}
```

Do not expose stack traces in production responses.

---

## 10. Caching and revalidation

The product is highly user-specific. Favor correctness over aggressive caching.

After mutations:

- Revalidate or refresh the relevant route/data.
- Prefer read-your-writes behavior for task/note changes.
- Do not cache private user data in a way that could cross users.

Use Next.js cache APIs deliberately. Do not add custom caching unless profiling shows a need.

---

## 11. Optimistic UI

Use optimistic UI for actions where failure can be safely reversed:

- Complete task
- Uncomplete task
- Toggle checklist item
- Archive

The UI must show a recovery path when the server mutation fails.

Do not optimistic-update irreversible destructive actions.

---

## 12. Rich-text persistence

Store Tiptap JSON as the canonical rich representation.

Also store a plain-text projection for search and AI retrieval.

Example:

```text
content_json = Tiptap JSON
content_text = "plain text extracted from document"
```

The projection should be regenerated when content changes.

Do not render raw untrusted HTML directly.

---

## 13. AI architecture

Create a server-only AI module:

```text
src/lib/ai/
  index.ts
  provider.ts
  schemas.ts
  prompts.ts
  context.ts
  usage.ts
```

### Responsibilities

`provider.ts`

- Provider adapter
- Model selection
- Streaming/structured output wrappers

`schemas.ts`

- Zod schemas for AI outputs

`context.ts`

- Workspace retrieval
- Context size limits
- User ownership checks

`usage.ts`

- Usage accounting
- Request limits

`prompts.ts`

- Versioned task-specific prompts

AI requests must never happen from a browser component using a secret API key.

---

## 14. AI retrieval strategy V1

No vector database.

Use:

1. Search query normalization.
2. PostgreSQL lexical matching.
3. Type-aware ranking.
4. Recency boost for recent notes/tasks.
5. Project/tag relationship boost.
6. Cap context by item count and approximate character/token budget.

Example ranking concept:

```text
score = text_match + title_match_bonus + project_match_bonus + recency_bonus
```

The formula does not need to be mathematically sophisticated in V1.

---

## 15. AI rate limiting

AI requests must have server-side per-user limits.

Minimum V1 safeguards:

- Max requests per minute
- Max daily AI operations per user
- Max input size
- Max output size
- Maximum context items

Store usage in `ai_usage`.

For V1, database-backed counters are acceptable.

---

## 16. Authentication integration

Use Better Auth mounted under:

`/api/auth/[...all]`

V1 authentication:

- email/password (verification required in production)
- Google and GitHub OAuth, with account linking by verified email (`trustedProviders: ["google", "github"]`)
- magic link plugin
- session cookies (30-day expiry, refreshed daily) with the `nextCookies` plugin for Server Actions
- password reset
- database-backed auth rate limiting

A social provider is enabled only when both its client ID and secret are set, so local development needs no OAuth apps.

Use a Next.js 16-compatible `proxy.ts` only for an optimistic session-cookie check and redirect. Authorization must still happen in server-side data access/actions via `requireUser()`.

Full configuration, flows and tests: `features/01-foundation-and-auth.md`.

---

## 17. Error handling

Define typed application errors:

- UNAUTHENTICATED
- UNAUTHORIZED
- NOT_FOUND
- VALIDATION_ERROR
- CONFLICT
- RATE_LIMITED (may carry `retryAfterSeconds`, also sent as a `Retry-After` header)
- AI_DISABLED (AI is switched off for the person, or no provider key is configured on the server)
- AI_PROVIDER_ERROR
- DATABASE_ERROR
- INTERNAL_ERROR

User-facing messages should be understandable.

Developer logs should contain:

- request/correlation ID
- feature/action
- error code
- stack trace where appropriate

Never log:

- passwords
- session tokens
- AI API keys
- full private note bodies unnecessarily

---

## 18. Environment variables

Create `.env.example`.

Expected variables:

```text
NODE_ENV
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL

GOOGLE_CLIENT_ID (optional pair)
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID (optional pair)
GITHUB_CLIENT_SECRET

RESEND_API_KEY (required in production)
EMAIL_FROM (required when RESEND_API_KEY is set)

AI_PROVIDER
AI_MODEL
AI_MODEL_FAST
AI_API_KEY
AI_BASE_URL (optional)
AI_LIMIT_PER_MINUTE
AI_LIMIT_PER_DAY

NEXT_PUBLIC_APP_URL
```

Do not commit secrets.

Create a server-only environment helper that validates required variables during startup/build where appropriate.

---

## 19. Seed data

Provide a development seed script.

Seed:

- one demo user (development only)
- 2 projects
- 5-8 tasks
- 4-6 todos
- 3 notes
- tags
- 2 inbox items

Do not seed production automatically.

---

## 20. Logging / observability

V1 minimum:

- structured JSON logs in production
- health endpoint
- application error logging
- request/correlation ID
- startup log with environment name, not secrets

Recommended later:

- Sentry
- OpenTelemetry
- product analytics

Do not make analytics a prerequisite for V1 launch.

---

## 21. Accessibility

Target WCAG 2.2 AA principles where practical.

Requirements:

- Full keyboard navigation
- Visible focus states
- Semantic headings
- Labels for inputs
- Dialog focus management
- Escape to close overlays
- Sufficient contrast
- Reduced-motion support
- Screen-reader-friendly status messages

Use shadcn/ui primitives rather than reinventing accessible dialogs/popovers/menus.

---

## 22. Performance targets

V1 targets:

- Fast initial render for authenticated dashboard
- No large client-side JavaScript bundle solely for convenience
- Lazy-load rich editor where appropriate
- Stream AI responses
- Avoid unnecessary client data fetching
- Avoid N+1 database queries

Measure before optimizing.

---

## 23. Testing architecture

### Unit tests — Vitest

Test:

- task status transitions
- recurrence parsing/validation
- date helpers
- task ranking
- search ranking
- AI context construction
- Zod schemas
- authorization helper behavior

### E2E — Playwright

Critical paths:

1. Sign up/sign in
2. Create task
3. Complete task
4. Create note
5. Edit rich text
6. Link note to task
7. Create project
8. Convert Inbox item
9. Search
10. Trash restore
11. AI task extraction using a mocked provider

Do not make the E2E suite depend on paid AI calls.

---

## 24. Dependency policy

Prefer a small dependency surface.

Before adding a package, verify:

- It is actively maintained.
- It supports React/Next.js versions used by V1.
- It solves a real product or engineering problem.
- It does not duplicate an existing library.

Avoid adding:

- Multiple UI libraries
- Multiple state management libraries
- Multiple date libraries
- Multiple form libraries

---

## 25. Suggested dependency set

### Core

- `next`
- `react`
- `react-dom`
- `typescript`
- `zod`
- `drizzle-orm`
- `postgres` or `pg`
- `better-auth` (+ its Drizzle adapter package if the pinned version ships it separately)
- `resend`
- `ai` + one provider package (Vercel AI SDK, used inside the AI provider adapter)

### UI

- `tailwindcss`
- `@tailwindcss/postcss`
- `shadcn/ui` generated components
- `lucide-react`
- `motion`
- `next-themes`
- `sonner`
- `cmdk` if needed by the command UI
- `date-fns` + `@date-fns/tz`
- `frimousse` (emoji picker) if it supports the pinned React version

### Editor

- `@tiptap/react`
- `@tiptap/pm`
- `@tiptap/starter-kit`
- required Tiptap extensions only

### Testing / quality

- `vitest`
- `@playwright/test`
- `eslint`
- `prettier`
- `husky`
- `lint-staged`

### Database tooling

- `drizzle-kit`
- `tsx`

Do not install every package in this list blindly; only add packages actually used.

---

## 26. State management recommendation

Do not add Redux/Zustand by default.

V1 should use:

- Server Components for server data
- Server Actions/Functions for mutations
- React local state for UI state
- URL search params for shareable/filterable state

TanStack Query may be introduced only where there is a concrete need for client-side caching, polling, or complex request lifecycles.

---

## 27. PWA readiness

V1 is a responsive web application first.

Prepare the architecture for future PWA support by:

- responsive layouts
- touch-friendly controls
- stable routes
- app metadata
- mobile-friendly icons/assets structure
- no assumption that a pointer/mouse exists

Do not implement offline synchronization or service-worker caching in V1.

---

## 28. Official reference documentation

Use official documentation as the version-aware source of truth during implementation:

- Next.js: https://nextjs.org/docs
- Next.js deployment: https://nextjs.org/docs/app/getting-started/deploying
- Next.js standalone output: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js Server Functions: https://nextjs.org/docs/app/getting-started/mutating-data
- Tailwind CSS: https://tailwindcss.com/docs
- shadcn/ui: https://ui.shadcn.com/docs
- Tiptap: https://tiptap.dev/docs/editor
- Better Auth: https://better-auth.com/docs
- Drizzle ORM: https://orm.drizzle.team/docs
- Motion: https://motion.dev/docs/react
- Vitest: https://vitest.dev/guide/
- Playwright: https://playwright.dev/docs/intro
- Docker: https://docs.docker.com/
