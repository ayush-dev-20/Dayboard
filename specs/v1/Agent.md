# Agent.md — Instructions for Claude Code / Coding Agent

## 1. Role

You are implementing V1 of a production-quality personal productivity web application combining Tasks, Notes, Projects, Inbox, Search, and practical AI capabilities.

The application is web-first and must be deployable as a Dockerized Next.js application.

The repository is also a learning project for deployment and DevOps. Do not optimize only for local development. The final architecture must be understandable and deployable by one developer.

---

## 2. Source of truth

Read these files before implementing:

1. `01-product-spec.md`
2. `02-technical-spec.md`
3. `03-ui-ux-spec.md`
4. `04-devops-deployment-spec.md`
5. `05-project-plan.md`
6. `features/README.md` and the feature doc you are implementing (`features/01-…` to `features/06-…`)

Treat them as the V1 source of truth. The feature docs are the technical breakdown of the five specs above. Build one feature at a time, in order.

If there is a conflict:

1. Product behavior follows `01-product-spec.md`.
2. Architecture follows `02-technical-spec.md`.
3. Interaction/visual behavior follows `03-ui-ux-spec.md`.
4. Deployment follows `04-devops-deployment-spec.md`.
5. Build order follows `05-project-plan.md`.

---

## 3. Hard technical constraints

Use:

- Next.js 16.x
- App Router
- React 19.x
- TypeScript
- pnpm
- Node.js 24 LTS
- Tailwind CSS v4
- shadcn/ui
- Tiptap
- PostgreSQL
- Drizzle ORM
- Better Auth
- Zod
- Docker
- Docker Compose
- Caddy for production reverse proxy
- GitHub Actions for CI/CD

Do not replace Next.js with another framework.
Do not turn the application into a separate Express/Nest backend unless an explicitly documented blocker requires it.
Do not introduce microservices for V1.

---

## 4. UI library rules

Use shadcn/ui as the only full component system.

Do not install another component library.

Use Lucide for icons.
Use Motion only for meaningful interaction.
Use semantic design tokens.

Prefer composition over giant components.

---

## 5. Next.js architecture rules

Use Server Components by default.

Use Client Components only when browser interactivity requires them.

Use Server Functions/Actions for normal mutations where appropriate.
Use Route Handlers for streaming AI, health endpoints, auth handlers, and HTTP-specific integrations.

Never trust UI route protection alone.
Every server action/query/mutation must derive the authenticated user on the server and enforce ownership.

Do not use client-side state as the source of truth for persisted data.

---

## 6. Database rules

Use Drizzle migrations.

Never modify an already-applied migration.

Every schema change must have a migration file.

All user-owned records must have `user_id` ownership.

Queries must scope by authenticated user.

Relationships must also be ownership-checked.

Use UUIDs or another robust ID strategy consistently; do not mix strategies without a clear reason.

Store note rich content as structured JSON and maintain a plain-text projection for search.

---

## 7. Authentication rules

Use Better Auth. Do not replace it with Clerk, Auth.js, or a custom auth implementation.

V1 sign-in methods: email/password, Google, GitHub, magic link. Configuration details: `features/01-foundation-and-auth.md`.

Keep authentication configuration in a server-only module.

Get the user only through `requireUser()`. It is the single entry point for the session user in every page, action and route handler.

Never expose secrets to client code.

Never accept arbitrary `userId` from a client and trust it.

For protected operations:

```text
session -> currentUserId -> authorized query/mutation
```

Do not leak whether another user's resource exists.

---

## 8. AI rules

AI is a feature layer, not the architecture of the entire application.

Implement a replaceable provider adapter.

All AI calls must happen server-side.

All AI request/response schemas must be validated with Zod.

AI-generated mutations must follow:

```text
Generate -> Preview -> User confirms -> Persist
```

Never silently create or modify tasks/notes from AI.

AI context must be user-scoped and bounded.

Do not send the entire workspace to the model unless the user explicitly asks for a workspace-wide action and the implementation has been designed to safely bound context.

Add a mock AI provider for automated tests.

Do not make CI depend on paid AI API calls.

Never include a model/provider API key in browser bundles.

---

## 9. Rich-text editor rules

Use Tiptap.

Keep the canonical document in Tiptap JSON.

Generate a plain-text projection for search and retrieval.

Handle SSR correctly; editor initialization must happen client-side where required.

Do not store raw HTML as the canonical representation.

Do not add image/file uploads in V1.

---

## 10. State management rules

Do not install Redux or Zustand by default.

Prefer:

- Server Components
- Server Actions/Functions
- React local state
- URL search params

Use TanStack Query only if a concrete requirement appears that cannot be handled cleanly with the Next.js architecture.

---

## 11. Error handling

Create a consistent error model.

Do not expose stack traces to users.

Return useful user-facing messages.

Log enough context for debugging without logging secrets or unnecessary private user content.

Every mutation should have a clear failure state.

Every async AI operation needs a retry path where appropriate.

---

## 12. UX rules

The product should feel calm, modern, and keyboard-friendly.

Avoid:

- excessive cards
- excessive gradients
- giant hero sections inside the app
- excessive animation
- modal overload
- AI badges on every screen

The Today screen must remain useful without AI.

AI should appear contextually inside Tasks, Notes, Inbox, Search, and Today.

---

## 13. Accessibility rules

Build accessible components by default.

Ensure:

- keyboard navigation
- visible focus
- accessible labels
- dialog focus management
- screen-reader-friendly status changes
- reduced-motion support
- no color-only status indicators

Do not remove accessible behavior just to simplify implementation.

---

## 14. Responsive rules

The application must work from approximately 360px width upward.

Do not design desktop first and simply shrink it.

For complex detail views:

- desktop: side sheet
- mobile: full-page route/view

Do not rely on hover for critical interactions.

---

## 15. Docker rules

Docker is part of the product, not an afterthought.

Use a multi-stage Dockerfile.

Use Next.js standalone output.

Do not ship the source tree unnecessarily in the runtime image.

Do not bake secrets into images.

Prefer a non-root runtime user.

Add health checks.

Use Docker Compose for local database and production orchestration.

---

## 16. Deployment rules

Production target is a single Linux VM running:

- Caddy
- Next.js
- PostgreSQL

Deployment must support:

- image pull
- migration
- restart
- health check
- rollback

Use immutable image SHA tags.

Do not deploy directly from a developer laptop in the normal workflow.

---

## 17. CI/CD rules

CI must run at minimum:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Playwright E2E should run against an ephemeral/test PostgreSQL environment.

CD should:

1. build image
2. push image
3. SSH to server
4. pull image
5. run migration
6. restart services
7. verify health

Do not mark deployment successful until the health check passes.

---

## 18. Testing rules

Write tests as features are implemented, not at the very end.

Prioritize tests around:

- authorization
- task state transitions
- note persistence
- search
- Inbox conversion
- AI structured output
- destructive actions
- critical end-to-end user journeys

Mock external AI providers in automated tests.

---

## 19. Dependency discipline

Before adding a dependency, ask:

1. Is it required?
2. Does an existing dependency already solve this?
3. Is it compatible with the selected Next.js/React versions?
4. Will it make deployment or maintenance harder?

Do not add dependencies merely because they are fashionable.

Use the lockfile.

---

## 20. Code quality

Prefer:

- small modules
- typed functions
- explicit domain logic
- server/client boundaries that are easy to understand
- reusable components
- descriptive names
- minimal hidden magic

Avoid:

- massive route files
- 500-line components
- generic `utils.ts` dumping grounds
- duplicated authorization logic when a shared helper is appropriate
- untyped `any` unless there is a clear boundary reason

---

## 21. Documentation requirements

As you implement, maintain:

- `README.md`
- `.env.example`
- local setup instructions
- Docker commands
- migration commands
- production deployment instructions
- rollback instructions
- backup/restore instructions

The README should be understandable to a developer cloning the repo for the first time.

---

## 22. Implementation behavior

When implementing a feature:

1. Read the relevant spec section.
2. Inspect the existing architecture.
3. Reuse existing components/services where appropriate.
4. Implement the smallest complete vertical slice.
5. Add validation.
6. Add tests.
7. Run lint/typecheck/tests.
8. Verify the UI manually where appropriate.
9. Update documentation if behavior or setup changed.

Do not rewrite working parts of the project without a concrete reason.

---

## 23. Do not overbuild V1

Do not implement V2/V3 features merely because the architecture could support them.

Specifically do not add yet:

- vector search
- offline sync
- calendar integrations
- team collaboration
- file storage
- voice input
- automation engine
- billing
- multi-tenant teams

Create clean extension points, then stop.

---

## 24. Definition of done for each feature

A feature is not done when it merely renders.

It is done when:

- UI works
- server behavior works
- validation exists
- authorization exists
- loading/error states exist
- relevant tests exist
- mobile layout works
- accessibility is considered
- production build still passes

---

## 25. Suggested initial commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm test:e2e
```

Exact script names may be refined, but equivalent capabilities are required.

---

## 26. Final instruction

Build V1 as a real product first and an AI demo second.

A user should be able to use Tasks, Notes, Projects, Inbox, Search, and Today every day even when the AI provider is unavailable.

A deployment failure should be diagnosable from logs, Docker Compose state, health checks, and documented procedures.

Keep the codebase ready for V2 and V3 without implementing those phases prematurely.
