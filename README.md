# Dayboard

A calm personal workspace for tasks, todos, notes and projects, with AI built in. Web-first, deployed as one Docker image.

This repository is built in phases from the specs in [specs/](specs/). Status: **V1 feature 01 (Foundation & auth)** is built. See [agent_docs/](agent_docs/README.md) for what exists and [CLAUDE.md](CLAUDE.md) for how work is organised.

## What works today

- Sign up and sign in with **email + password**, **Google**, **GitHub** or a **magic link**
- Email verification, password reset, one account per person (Google/GitHub link to an existing verified email)
- Onboarding (name, time zone, theme), then the app shell: sidebar, tablet sheet, phone bottom nav, light/dark/system theme
- Settings: profile, change email, sign-in methods, password, sessions (sign out other devices), appearance, productivity preferences, AI switch, delete account
- Placeholder pages for Inbox, Tasks, Notes, Projects, Search and Trash, filled in by later features

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24 LTS | `nvm use` reads `.nvmrc` |
| pnpm | 10 | `corepack enable` picks the version in `package.json` |
| PostgreSQL | 17 or newer | Docker (below) or a local install |
| Docker | optional | Only for the database container and the production image |

## Quick start

```bash
nvm use                      # Node 24
corepack enable
pnpm install

cp .env.example .env.local   # then fill in BETTER_AUTH_SECRET (see below)
docker compose up -d db      # PostgreSQL in a container (or use your own, see "Database")
pnpm db:migrate              # create the tables
pnpm db:seed                 # optional: demo user demo@dayboard.local / demo-password-1234
pnpm dev                     # http://localhost:3000
```

Generate the auth secret with `openssl rand -base64 32` and paste it into `.env.local`.

With no email provider configured, emails are **printed in the terminal** instead of sent, and email verification is not enforced. Click the link from the terminal output. With no Google or GitHub credentials, those buttons are simply hidden.

> **Port in use?** If `pnpm dev` starts on another port, set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` in `.env.local` to that origin. Auth rejects requests whose origin doesn't match.

### Database

`docker-compose.yml` runs PostgreSQL 17 on `127.0.0.1:5432` with user, password and database all `dayboard`, matching `.env.example`. If 5432 is taken, run `DB_PORT=5433 docker compose up -d db` and change the port in `DATABASE_URL`.

Without Docker, create any database and point `DATABASE_URL` at it, for example `postgres://localhost:5432/dayboard_dev`.

## Environment variables

Validated at startup by [src/lib/env-schema.ts](src/lib/env-schema.ts). A missing or invalid value stops the app with a list of every problem. `.env.example` is the template; real values never go in Git or an image.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Signs sessions. 32+ characters. Changing it signs everyone out |
| `BETTER_AUTH_URL` | yes | Public origin of the app. Must be `https://` in production |
| `NEXT_PUBLIC_APP_URL` | yes | Same origin, for links built in the browser |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional pair | Enables "Continue with Google". Set both or neither |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | optional pair | Enables "Continue with GitHub". Set both or neither |
| `RESEND_API_KEY`, `EMAIL_FROM` | **required in production** | Sends verification, reset and sign-in emails. Empty in development means "print to the terminal" |
| `E2E`, `E2E_EMAIL_FILE` | tests only | Console email sender in a production build; where captured emails go. **Never set in a real deployment** |

AI settings (`AI_PROVIDER`, `AI_API_KEY`, ...) arrive with feature 05.

## Setting up Google and GitHub sign-in

Use a separate OAuth app for local development and for production. Each provider needs the callback URL below, where `{origin}` is `BETTER_AUTH_URL`.

| Provider | Where | Callback URL |
| --- | --- | --- |
| Google | Google Cloud Console, APIs & Services, Credentials, OAuth client ID, type **Web application** | `{origin}/api/auth/callback/google` |
| GitHub | GitHub, Settings, Developer settings, OAuth Apps | `{origin}/api/auth/callback/github` |

Local example: `http://localhost:3000/api/auth/callback/google`. GitHub allows one callback URL per app, so make one app for local and one for production. For Google, also publish the OAuth consent screen (or add test users) before real people try it. Then put the client ID and secret in `.env.local`.

## Email (Resend)

Create a Resend account, verify your sending domain (add the SPF and DKIM records it shows), create an API key, and set `RESEND_API_KEY` and `EMAIL_FROM` (for example `Dayboard <hello@example.com>`). Production will not start without them, because magic links and password resets cannot work.

## Commands

```bash
pnpm dev            # development server
pnpm build          # production build (standalone output)
pnpm start          # run the production build

pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # unit tests (Vitest)
pnpm test:integration  # real actions against the test database, see below
pnpm test:e2e       # browser tests (Playwright), see below

pnpm db:generate    # create a migration after changing src/db/schema
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse the database (development only)
pnpm db:seed        # demo user with sample tasks, todos, projects, tags, notes and inbox items (development only; refuses to run in production)
pnpm build:migrate  # bundle the migration runner used in the production image
```

Rules for migrations: every schema change gets a new migration; never edit one that has been applied.

## Tests

- **Unit** (`tests/unit`): pure logic such as env validation, redirect safety, dates, validation schemas, error and log handling, `requireUser()`.
- **Integration** (`tests/integration`): the real Server Actions against the `dayboard_test` database (set `E2E_DATABASE_URL` to change it; it never touches `DATABASE_URL`). Only the session, `next/cache`, headers and navigation are replaced. Covers task, todo, note, project, tag, inbox, Today, search and Trash rules (recurrence, ordering, note versions and conflicts, project Trash behaviour, tag uniqueness, inbox conversion transactions, search escaping, Trash restore and empty) and that one user can never reach another's rows.
- **End to end** (`e2e`): real browser against a production build, a separate `dayboard_test` database and a mailbox file in place of email. Covers tasks and todos (create, edit, complete and Undo, subtasks, repeat, rich text, emoji, keyboard, offline autosave, phone layout), notes (autosave offline, conflicts, draft recovery), projects, tags and task–note links, quick capture and the command menu, Today, search and Trash, as well as sign-up and verification, sign-in and out, password reset, magic link, route protection, settings, account deletion, session handling, one user not seeing another's data, and phone, tablet and desktop layouts.

```bash
createdb dayboard_test        # once (or set E2E_DATABASE_URL)
pnpm test:e2e                 # migrates, builds, serves on :3100, runs the suite
```

On a busy machine, `pnpm test:e2e --workers=4` avoids timeouts. Stop any server left on :3100 before running: Playwright reuses it, and an old build gives misleading results. The test build goes to `.next-e2e` (set by `NEXT_DIST_DIR`), so it never disturbs a running `pnpm dev`. Build folders must start with `.next-` so they stay git-ignored; Tailwind scans every folder that isn't.

Locally the tests use your installed Google Chrome; set `CI=1` to use Playwright's own Chromium (`pnpm exec playwright install chromium`). Google and GitHub sign-in are not exercised against the real providers in automated tests; see the manual checklist below.

## Running the production image

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose --profile full up --build
```

This builds the multi-stage `Dockerfile`, runs migrations as a one-shot `migrate` service, then starts the app on `:3000` with a health check at `/api/health`. The `full` profile uses `E2E=true` so a production build can start without a mail provider; read emails with `docker compose exec web cat /tmp/emails.jsonl`.

Production deployment (Caddy, HTTPS, CI/CD, backups, rollback) is feature 06; the specs are in [specs/v1/04-devops-deployment-spec.md](specs/v1/04-devops-deployment-spec.md).

## Manual checks no automated test can do

Run these with real credentials before a release:

- [ ] Sign up and sign in with Google; sign in with GitHub
- [ ] Sign in with Google using an email that already has a password account: you land in the **same** account (one user, not two)
- [ ] A password account whose email was never verified cannot be taken over by signing in with Google (you should see the "isn't confirmed yet" message)
- [ ] Verification, reset and magic-link emails arrive from Resend and are not marked as spam
- [ ] Unlinking a provider works, and removing your last sign-in method is refused

## Project layout

```text
src/
  app/            routes: (auth) sign-in etc., (onboarding), (app) the signed-in app, api/
  components/     ui/ (shadcn-style primitives), layout/, auth/, settings/
  actions/        Server Actions (mutations)
  db/             Drizzle client, schema/, queries/
  lib/            auth, session (requireUser), env, errors, logger, email, dates, validations
  hooks/
  styles/         globals.css: the design tokens from DESIGN.md
scripts/          migrate.ts, seed.ts
drizzle/          migrations
tests/ e2e/       unit and browser tests
specs/ designs/ DESIGN.md agent_docs/ docs/
```

More: [docs/README.md](docs/README.md) (system overview), [agent_docs/](agent_docs/README.md) (what each feature built and why), [docs/decisions/](docs/decisions/README.md) (architecture decisions).
