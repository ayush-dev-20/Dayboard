# V1 Implementation Plan — Build Order and Definition of Done

## 1. Build philosophy

Implement V1 in vertical slices rather than building every database model first and UI later.

Each phase should leave the application runnable.

Suggested sequence:

```text
Foundation
  -> Auth
  -> Tasks
  -> Notes
  -> Projects + Tags
  -> Inbox
  -> Search
  -> AI
  -> UX polish
  -> Tests
  -> Docker
  -> CI/CD
  -> Production
```

Do not wait until the end to test Docker or deployment.

### Phases → feature docs

The phases below are grouped into six buildable features in `features/`:

| Feature doc | Phases |
| --- | --- |
| `01-foundation-and-auth.md` | 0, 1 |
| `02-tasks-and-todos.md` | 2 |
| `03-notes-projects-tags.md` | 3, 4, 5 |
| `04-inbox-today-search-trash.md` | 6, 7, 8 (+ Trash) |
| `05-ai-assistant.md` | 9, 10 |
| `06-production-devops.md` | 13–16, interleaved from feature 01 onward |

Phases 11 (UX polish) and 12 (testing) are not separate features. Every feature doc includes its own tests and definition of done, and a final polish pass runs after feature 05.

---

## 2. Phase 0 — repository foundation

Create:

- Next.js 16 App Router project
- TypeScript
- pnpm
- Tailwind CSS v4
- shadcn/ui
- ESLint
- Prettier
- Husky + lint-staged
- environment validation
- base layout
- dark/light/system theme

Definition of done:

- app starts locally
- lint passes
- typecheck passes
- production build passes

---

## 3. Phase 1 — database and auth

Implement:

- PostgreSQL
- Drizzle
- migrations
- seed
- Better Auth (email/password, Google, GitHub, magic link)
- Resend email sender + console sender for development
- protected application routes
- account settings

Definition of done:

- user can sign up and sign in with each of the four methods
- Google/GitHub sign-in with an existing email links to the same account
- user can sign out
- unauthenticated users cannot access private pages
- user A cannot query user B data
- password reset flow works when email provider is configured

---

## 4. Phase 2 — task system

Implement:

- task list
- create task
- edit task
- complete/uncomplete
- priorities
- due dates
- status
- subtasks
- project relation placeholder
- trash
- restore

Definition of done:

A user can manage tasks without using Notes or AI.

---

## 5. Phase 3 — notes

Implement:

- notes list
- create note
- rich-text editor
- autosave
- edit title
- delete/restore
- note search projection

Definition of done:

A user can reliably use the app as a standalone note-taking application.

---

## 6. Phase 4 — projects and tags

Implement:

- project CRUD
- project dashboard
- task assignment
- note assignment
- tags
- filtering

Definition of done:

A project can contain both tasks and notes.

---

## 7. Phase 5 — task-note relationships

Implement:

- link task to note
- unlink
- related notes on task
- related tasks on note

Definition of done:

A user can move naturally between action and context.

---

## 8. Phase 6 — Inbox

Implement:

- quick capture
- inbox list
- archive
- convert to task
- convert to note
- convert to task + note

Definition of done:

A user can capture a thought in under 10 seconds.

---

## 9. Phase 7 — Today

Implement:

- daily layout
- overdue
- due today
- completed today
- recent notes
- focus selection
- quick actions

Definition of done:

Today is useful without AI.

This is critical: AI should enhance the product, not rescue a weak core experience.

---

## 10. Phase 8 — Search

Implement:

- Cmd/Ctrl + K
- keyword search
- filters
- grouped results
- keyboard navigation

Definition of done:

Users can find tasks, notes, projects, and tags without opening each section manually.

---

## 11. Phase 9 — AI foundation

Implement:

- provider adapter
- request validation
- output schemas
- usage tracking
- rate limiting
- prompt module
- model configuration
- mocked AI provider for tests

Definition of done:

AI features can be tested without calling a real provider.

---

## 12. Phase 10 — AI features

Implement in this order:

1. Text -> tasks
2. Break task into subtasks
3. Summarize note
4. Extract action items
5. Ask my workspace
6. Daily suggestion
7. Overdue cleanup

For every AI mutation:

```text
Generate
  -> Preview
  -> User confirms
  -> Persist
```

Never:

```text
Generate -> silently mutate
```

---

## 13. Phase 11 — UX polish

Review:

- mobile layout
- keyboard shortcuts
- accessibility
- loading states
- errors
- empty states
- undo flows
- responsive editor
- reduced-motion behavior

Run through all core journeys as a normal user rather than as a developer.

---

## 14. Phase 12 — testing

Unit tests:

- domain rules
- authorization
- validations
- search ranking
- AI context construction

E2E tests:

- auth
- task lifecycle
- note lifecycle
- project flow
- inbox flow
- search
- trash
- AI mocked flow

Required commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

---

## 15. Phase 13 — Docker

Implement:

- multi-stage Dockerfile
- standalone Next.js output
- non-root runtime if compatible
- local Compose
- production Compose
- PostgreSQL volume
- health check
- Caddy

Verification:

```bash
docker build -t app:test .
docker compose -f docker-compose.prod.yml up -d
curl http://localhost:<port>/api/health
```

The exact ports depend on the chosen Compose configuration.

---

## 16. Phase 14 — CI

CI must run on a clean checkout.

Required checks:

- install from lockfile
- lint
- typecheck
- unit tests
- production build
- Playwright tests

The CI environment should provision a temporary PostgreSQL service/container for integration/E2E tests.

---

## 17. Phase 15 — CD

Implement:

- container registry
- image SHA tags
- SSH deployment
- migration step
- health check
- restart
- deployment logs

Definition of done:

A merge to main can produce a deployed production release without manual Docker commands from a developer laptop.

---

## 18. Phase 16 — backup and rollback

Implement:

- backup script
- backup rotation
- manual restore documentation
- rollback documentation

Test both before calling V1 production-ready.

---

## 19. Suggested Git workflow

Use:

```text
main
  |
  +-- feature/*
  +-- fix/*
  +-- chore/*
```

Pull requests should pass CI before merge.

Commit style can be conventional commits if desired, but it is optional.

---

## 20. Suggested milestones

### M1 — app foundation

Auth + database + shell

### M2 — core productivity

Tasks + notes

### M3 — organization

Projects + tags + links + Inbox

### M4 — intelligence

Search + AI

### M5 — production

Tests + Docker + CI/CD + HTTPS + backups

---

## 21. V1 launch checklist

### Product

- [ ] Today is useful
- [ ] Task lifecycle works
- [ ] Note editor works
- [ ] Projects work
- [ ] Inbox works
- [ ] Search works
- [ ] Trash works
- [ ] AI features work with confirmation

### Security

- [ ] Auth enforced server-side
- [ ] User data isolated
- [ ] Secrets excluded from repo/image
- [ ] AI endpoints rate-limited
- [ ] HTTPS enabled
- [ ] DB not public

### Quality

- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Production build passes
- [ ] Mobile browser tested
- [ ] Keyboard flows tested
- [ ] Reduced motion tested

### Operations

- [ ] Docker build works
- [ ] Compose production works
- [ ] Health check works
- [ ] Migrations documented
- [ ] CI works
- [ ] CD works
- [ ] Rollback tested
- [ ] Backup tested

---

## 22. What to measure after launch

Do not add complex analytics before the product works.

Track manually or with lightweight analytics later:

- daily active users
- tasks created/completed
- notes created
- Inbox conversion rate
- AI feature usage
- failed AI requests
- average AI response time
- task completion rate
- crash/error count

These metrics can inform V2.

---

## 23. V1 technical suggestions for future phases

Keep extension points for:

- semantic search using pgvector
- PWA/service worker
- calendar integration
- email integration
- file storage
- object storage
- voice capture
- AI weekly review
- recurring automation engine
- background jobs
- multi-device sync improvements

Do not implement these now; preserve clean boundaries so they can be added later.
