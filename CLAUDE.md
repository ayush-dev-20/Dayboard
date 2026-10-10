# CLAUDE.md — Dayboard

Dayboard is a personal workspace for tasks, todos, notes and projects, with AI built in. It is built in three phases (V1, V2, V3) by many agent sessions, one after another. No single session remembers the last one. This file explains how we keep a shared memory so each session can continue the work instead of guessing.

> Status: the repo currently holds specs, designs and docs only. If `src/` does not exist yet, V1 feature 01 has not started.

## 1. Why agent_docs exists

Every agent starts with a blank head. The code shows *what* exists, but not *why* it was built that way, what was left out on purpose, or what to watch for. Without that, agents rebuild things that already work, undo earlier decisions, or break hidden assumptions.

`agent_docs/` is the fix. It is a short written hand-off, one file per feature, left by the agent that did the work for the agent that comes next. Think of it as notes passed between shifts.

Rules of the road:

- **Write for the next agent and for a human.** Plain words, no jargon, short.
- **Facts only.** Say what is true now. Do not describe plans as if they were done.
- **The code is the source of truth for behavior; agent_docs is the source of truth for intent.** If the two disagree, check the code, then fix the doc.
- **A stale doc is worse than no doc.** Update or delete it.

## 2. Tech stack (strict, every iteration)

This stack is fixed. Use it for every iteration, in every phase. Do not swap a piece, add a second tool that does the same job, or "try something else". Exact versions are pinned by `pnpm-lock.yaml`; do not hard-code version assumptions elsewhere. Source: [specs/v1/02-technical-spec.md](specs/v1/02-technical-spec.md) sections 1 and 24–26, and [specs/v1/Agent.md](specs/v1/Agent.md) section 3.

| Layer | Use |
| --- | --- |
| Framework | Next.js 16.x, App Router, React 19.x, TypeScript (strict) |
| Runtime and packages | Node.js 24 LTS, pnpm |
| Styling and UI | Tailwind CSS v4, shadcn/ui (the only component library), Lucide icons, Motion (sparingly), next-themes, Sonner (toasts), `cmdk` (command menu) |
| Rich text | Tiptap (ProseMirror); client-side init; JSON is canonical, plus a server-built plain-text projection |
| Data | PostgreSQL, Drizzle ORM, Drizzle Kit migrations, UUID ids |
| Server code | Server Components for reads; Server Actions for mutations; Route Handlers only for streaming/AI, health, auth, webhooks |
| Auth | Better Auth (Drizzle adapter): email/password, Google, GitHub, magic link |
| Email | Resend behind the `EmailSender` interface (console sender in dev) |
| Validation | Zod, for every action input and every AI output |
| AI | Vercel AI SDK (`ai` + one provider package) used **inside** the provider adapter only; a mock provider for tests and CI |
| Dates | `date-fns` + `@date-fns/tz`, through `src/lib/dates/` |
| Emoji picker | `frimousse` (if it supports the pinned React version; otherwise a one-grapheme text input) |
| Testing | Vitest (unit), Playwright (E2E); the AI provider is always mocked in CI |
| Quality | ESLint, Prettier, Husky, lint-staged |
| DevOps | Docker (multi-stage, Next.js standalone output), Docker Compose, Caddy, GitHub Actions, GHCR |
| Fonts | Inter (variable, with the optical-size axis for headings; open-licensed, self-hosted) and the system monospace for code only, per [DESIGN.md](DESIGN.md) and ADR 0003 |

**Not allowed** (unless an ADR in `docs/decisions/` approves it first):

- Another framework, or a separate Express/Nest backend, or microservices. The app is a modular monolith.
- Another UI library (Material UI, Chakra, Ant Design, Mantine, etc.).
- Clerk, Auth.js/NextAuth, or custom auth or password hashing.
- Redux or Zustand. Use server components, actions, local state and URL params.
- A second date library, form library, or icon set.
- Any package you do not actually use. Before adding one, check: is it required, does something we already have do the job, does it work with our Next.js/React versions, does it make deployment harder? Commit the lockfile.

**Added only in later phases** (do not install early; leave a clean extension point):

- **V2:** Serwist (PWA), Dexie (IndexedDB), TanStack Query, pgvector, a background worker, S3-compatible object storage, Web Push. Provider code (calendar, storage, AI) lives behind adapters.
- **V3:** the module layout in [specs/v3/Agent.md](specs/v3/Agent.md) section 3, with collaboration, automation and integrations kept out of ordinary business modules.

**Commands every project must support** (names may be refined, the capability may not): `pnpm dev`, `lint`, `typecheck`, `test`, `test:e2e`, `build`, `db:generate`, `db:migrate`, `db:studio`, `db:seed`.

## 3. Source of truth: the specs, and what to read every iteration

The specs in `specs/` are authoritative. Each version has the same five files plus an `Agent.md` with that version's coding rules.

| Phase | Folder | What it is |
| --- | --- | --- |
| V1 | [specs/v1/](specs/v1/) | Tasks, todos, notes, projects, inbox, search, AI, Docker deploy. Build one feature at a time using [specs/v1/features/](specs/v1/features/README.md). |
| V2 | [specs/v2/](specs/v2/) | Offline/PWA, sync, semantic search, calendar, files, voice, weekly review. Evolves V1; do not rewrite it. |
| V3 | [specs/v3/](specs/v3/) | Collaboration, permissions, automation, integrations, agent tools. Extends the V1/V2 monolith. |

### Every iteration reads the V1 specs

V1 is the baseline for the whole project. **At the start of every iteration, in every phase, read the V1 files below that relate to your task.** Do not rely on memory or on this summary. For V1 work, read all of them. For V2 or V3 work, V1 is still your baseline, so read the V1 files that cover whatever you are touching, then your own phase's files.

| File | Read it for |
| --- | --- |
| [specs/v1/Agent.md](specs/v1/Agent.md) | Hard rules: stack, server/client boundaries, auth, AI, database, accessibility, definition of done. Always read. |
| [specs/v1/01-product-spec.md](specs/v1/01-product-spec.md) | What each feature must do: fields, statuses, behavior, non-goals, acceptance criteria. |
| [specs/v1/02-technical-spec.md](specs/v1/02-technical-spec.md) | Architecture, source layout, database model and indexes, authorization, validation, caching, AI design, errors, env vars, testing. |
| [specs/v1/03-ui-ux-spec.md](specs/v1/03-ui-ux-spec.md) | Layout, navigation, interactions, keyboard shortcuts, empty/loading/error states, motion, mobile and accessibility rules. |
| [specs/v1/04-devops-deployment-spec.md](specs/v1/04-devops-deployment-spec.md) | Dockerfile, Compose, Caddy, health checks, migrations, CI/CD, rollback, backups, security baseline. Read whenever you touch Docker, config, env vars, migrations, scripts or workflows. |
| [specs/v1/05-project-plan.md](specs/v1/05-project-plan.md) | Build order, phases, definitions of done, launch checklist, milestones. |
| [specs/v1/features/README.md](specs/v1/features/README.md) and the feature doc you are building (`01`–`06`) | The concrete build breakdown: data model, server contract, UI, rules, tests, definition of done. |

For V2 and V3 work, also read that phase's `Agent.md` and `01`–`05` in full.

**Precedence.** Work in the phase you were asked to work in, and follow that phase's `Agent.md`. Earlier-phase constraints stay in force unless a later spec explicitly changes them. Within a phase, when specs disagree: product behavior follows `01`, architecture follows `02`, interaction follows `03`, deployment follows `04`, build order follows `05`. If a spec is wrong or you need to differ from it, write an ADR in `docs/decisions/` first (see section 8). Do not silently diverge.

## 4. Design: look in `designs/` and `DESIGN.md`

For anything the user sees, the design already exists. Do not invent a layout or a style.

- **[designs/](designs/)** holds the screen designs for the app (HTML). Look at the one for your screen before building any UI. Since feature 07 (UI modernization, ADR 0005) the v1 files are **stale for visual style** (fonts, flat panels, red overdue pills, flush-left layout) but still right for content and states; new mockups go in `designs/v2/`. Where a v1 design and DESIGN.md disagree on style, follow DESIGN.md.
- **[DESIGN.md](DESIGN.md)** is the design system behind them: colors (light and dark), typography, spacing, shapes, components, screen recipes, and a Do's and Don'ts list. Its colors are **generated** by `pnpm theme:generate` from three inputs (paper, ink, contrast) in `src/lib/theme/generate.ts`; never hand-edit a generated hex. It must lint clean: `npx -y @google/design.md@latest lint --format json DESIGN.md`.

| Feature | Design file(s) in `designs/` |
| --- | --- |
| 01 Foundation and auth (sign-in, onboarding, settings, app shell) | `Sign_in_and_Onboarding.html`, `Settings.html` |
| 02 Tasks and todos | `Tasks_and_Todos.html` |
| 03 Notes, projects, tags | `Notes.html`, `Projects.html` |
| 04 Inbox, Today, search, trash | `Today_and_Inbox.html`, `Search_and_Trash.html` |
| 05 AI assistant | `AI_Assistant.html` |
| 06 Production and DevOps | none (no UI) |

**How to read a design file.** Each file is a single, large self-extracting HTML bundle (about 3–12 MB). Do not `cat` or read it as text: you will fill your context with encoded data and learn nothing. Open it in a browser, or load it with Playwright, and take screenshots of the screens you need. If you cannot open a browser in your environment, say so in your agent_docs hand-off and build from DESIGN.md and the UI/UX spec instead.

**When sources disagree.** The designs show how a screen looks (layout, content, states). DESIGN.md holds the exact token values and the rules. If a design and DESIGN.md differ on a *token value*, use DESIGN.md. If they differ on a *layout or behavior*, or you cannot tell which is meant, follow the design and the UI/UX spec, and note the difference in your agent_docs hand-off so the user can resolve it. Do not quietly pick one.

Always apply the rules in DESIGN.md that are easy to forget: one accent color used only for interactive things, hairlines by default and a card only for one discrete object (never a list of rows in a card), the four shadow levels and no glow or gradients, red is rare (overdue rows are red text, at most one red fill per section), only 400 and 600 font weights, square checkboxes for tasks and round ones for todos, no sparkle icons, AI badges or docked chat sidebar (the assistant's floating chat button is allowed, ADR 0015), at most two feature animations per screen, and color is never the only signal.

## 5. Reading order for a new agent

Do these in order. **Do not start coding before step 6.**

1. **This file (CLAUDE.md).**
2. **The V1 specs that relate to your task** (section 3). `Agent.md` first, then `01`–`05`. For V1, all of them plus `features/README.md` and your feature doc.
3. **Your phase's specs**, if you are working on V2 or V3 (`Agent.md`, then `01`–`05`).
4. **The design** (section 4): the `designs/` file for your screens, and `DESIGN.md`.
5. **`agent_docs/`:** read `agent_docs/README.md`, then every file for features you depend on or touch. This says what is already built and what was left out on purpose. For V2 and V3, include the earlier phases' files.
6. **The codebase:** inspect the files named in those docs, then search for anything else related before you add code. Confirm the docs still match reality.

## 6. When and how to update agent_docs

**Create or update a file when:**

- You finish a feature (or a clear vertical slice of one).
- You stop mid-feature, for any reason (running out of context, a blocker, the user redirected you). Mark it clearly as in progress.
- You change something an existing doc describes. Update that doc. Do not add a second file for the same feature.
- You defer something on purpose, or discover a gotcha the next agent would trip over (including any design or spec mismatch from section 4).

**Do not write one for:** typo fixes, small refactors, dependency bumps, or bug fixes that change no behavior or intent. Put those in the commit message.

**How:**

1. Filename: `agent_docs/{feature-name}_{phase}.md`. Feature name in lowercase kebab-case, phase in lowercase. Examples: `foundation-and-auth_v1.md`, `tasks-and-todos_v1.md`, `offline-sync_v2.md`. Use the same feature names as the spec's feature docs where they exist.
2. Use the template below. Keep the whole file to about one screen.
3. Add or update the line for it in `agent_docs/README.md`.
4. Do this **before you end your session**, in the same change as the code when possible.

### Template

```markdown
# Feature: <Name>

**Phase:** V1 | V2 | V3
**Status:** Done | In progress
**Date:** YYYY-MM-DD (completed or handed off)

## What was built
- 2–3 short bullets or sentences, in plain words.

## Why
The problem this solves and why it was done this way.

## What was deferred
Known limits, and anything pushed to a later phase. Say which phase if known.

## Related files
- `path/to/key-file.ts`: one line on what it does

## Hand-off notes
Dependencies, gotchas, and links to related features (`other-feature_v1.md`) or ADRs.
```

## 7. What NOT to rebuild or duplicate

Before writing anything, search the codebase and `agent_docs/`. If it exists, reuse or extend it. The specs already name these shared pieces; each is built once:

- **Auth:** Better Auth, and `requireUser()` as the only way to get the current user. Do not add another auth system or read a user id from the client.
- **UI kit:** shadcn/ui is the only component library. Do not add another one. Use Lucide icons and the tokens in DESIGN.md.
- **Shared components:** `TaskRow`, `TodoRow`, `TaskList`, `NoteCard`, `EmptyState`, `ConfirmDialog`, `CommandMenu`, `EmojiPicker`. Never copy a slightly different version into another page.
- **Rich text:** one `RichTextEditor` (Tiptap), the `useAutosave` hook, and the server-side plain-text projection. Do not add a second editor or let the client send `*_text`.
- **Dates:** everything goes through `src/lib/dates/`. Do not add another date library or do date math in components.
- **Task logic:** status changes and recurrence live in `src/lib/tasks/` as pure functions. Do not put them in components or actions.
- **Search:** one lexical search module in `src/lib/search/`. "Ask my workspace" reuses it.
- **AI:** one provider adapter with a mock provider. All AI calls are server-side, validated with Zod, and follow Generate → Preview → Confirm → Persist. Never call a provider SDK from UI code.
- **Email:** the `EmailSender` interface. Do not call a mail provider directly.
- **Errors, logging, validation:** the shared error model, the logger, and one Zod schema per action in `src/lib/validations/`.
- **Migrations:** never edit a migration that has already been applied. Add a new one.
- **Out of scope:** do not build features from a later phase early. Leave a clean extension point and stop. Do not rewrite working earlier-phase code for style.

If you think an existing piece is wrong, fix it in place and note why in agent_docs, or write an ADR if it is an architecture change. Do not build a parallel version.

## 8. Project documentation

| Folder | Purpose | Who writes it |
| --- | --- | --- |
| [agent_docs/](agent_docs/README.md) | Per-feature hand-off notes. Short, current. | The agent that did the work |
| [docs/](docs/README.md) | System overview for onboarding new developers: how it fits together, how to run it. | Anyone; keep it accurate |
| [docs/research/](docs/research/) | Investigation notes, RFCs, comparisons, design thinking. Date each note. | Anyone |
| [docs/decisions/](docs/decisions/README.md) | ADRs: one short file per architecture decision (context, decision, alternatives, consequences). Required when you depart from a spec, change the tech stack, or change architecture. Especially important in V3. | Anyone making the decision |
| [designs/](designs/) and [DESIGN.md](DESIGN.md) | The app's visual design. Read-only for feature work. Change only when the user asks. | The user / design work |

agent_docs says *what was built and what to know*. ADRs say *why we chose this architecture over the alternatives*. Link between them.

## 9. Working rules (apply in every phase)

- Build one vertical slice at a time. Keep the app runnable after each one.
- A feature is not done until its UI, server behavior, validation, authorization, loading/error states, tests, mobile layout and accessibility work. See [specs/v1/Agent.md](specs/v1/Agent.md) section 24.
- Every query and mutation is scoped to the signed-in user on the server. Hiding a button is not access control.
- Do not bundle unrelated refactors into a feature change.
- Do not log secrets or private note content.
- Before saying work is done, run the checks (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) and report the real result.
- Docker and deployment are part of the product, not an afterthought. Start the Dockerfile and local Compose early and keep them working.
