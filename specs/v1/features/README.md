# V1 Feature Specs

Each file in this folder is one buildable feature: a technical breakdown of what to build, drawn from the five top-level V1 specs.

Build them in order. Each feature leaves the app runnable and depends only on features before it.

| # | Feature | Covers | Depends on |
| --- | --- | --- | --- |
| 01 | [Foundation & Auth](01-foundation-and-auth.md) | Repo scaffold, env, DB base, Better Auth (email/password, Google, GitHub, magic link), app shell, Settings | — |
| 02 | [Tasks & Todos](02-tasks-and-todos.md) | Tasks, subtasks, recurrence, task detail with rich-text description, Todos, emoji | 01 |
| 03 | [Notes, Projects & Tags](03-notes-projects-tags.md) | Note editor + autosave, task-note linking, Projects, Tags | 01, 02 |
| 04 | [Inbox, Today, Search & Trash](04-inbox-today-search-trash.md) | Quick capture + conversion, Today screen, Cmd/Ctrl+K search, unified Trash | 01–03 |
| 05 | [AI Assistant](05-ai-assistant.md) | Provider adapter, usage limits, AI features A–G | 01–04 |
| 06 | [Production & DevOps](06-production-devops.md) | Docker, Compose, Caddy, CI/CD, migrations, backups, rollback, logging | 01 (starts early, see note) |
| 07 | [UI Modernization](07-ui-modernization.md) | DESIGN.md update, new tokens and depth, inset layout, Today and screen rebuilds, motion, inline AI styling, landing page, auth, onboarding, empty states, visual and accessibility tests | 01–05 (independent of 06) |

**Note on 06:** Deployment is a learning goal, so don't leave it to the end. Start the Dockerfile and local Compose during 01, and add CI once 02 lands. Finish CD, backups and rollback after 05. See the milestones in [06-production-devops.md](06-production-devops.md).

## How to use these docs

- The top-level specs (`../01-product-spec.md` … `../05-project-plan.md`, `../Agent.md`) remain the source of truth. These feature docs turn them into a concrete build breakdown. If the two disagree, fix whichever one is wrong. Don't silently diverge.
- Every feature doc follows the same structure: Scope → Data model → Server contract → UI → Rules → Tests → Definition of done → Out of scope.
- Agent.md §24 "Definition of done for each feature" applies to every feature on top of its own checklist.

## Cross-cutting conventions (apply to every feature)

- **IDs:** UUID v7 (time-sortable) for every table, including the Better Auth tables.
- **Ownership:** every user-owned row has `user_id` (FK → `user.id`, `ON DELETE CASCADE`). Every query and mutation scopes by the session user. See `../02-technical-spec.md` §7.
- **Soft delete:** `deleted_at` on tasks, todos, notes, projects. Normal queries always filter `deleted_at IS NULL`.
- **Timestamps:** `created_at`, `updated_at` as `timestamptz`, set by the server.
- **Emoji:** `emoji text NULL`, validated as a single grapheme cluster (one visible emoji, including ZWJ sequences and skin tones). Applies to tasks, todos and notes only.
- **Validation:** a Zod schema for every action input, in `src/lib/validations/<domain>.ts`.
- **Errors:** return the typed error codes from `../02-technical-spec.md` §17 in the shape `{ error: { code, message } }`.
- **Auth guard:** every Server Action or Route Handler starts with `const user = await requireUser()` (defined in 01).
