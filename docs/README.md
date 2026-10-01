# Dayboard docs

System overview for developers new to the project. Keep this accurate and short; update it when the setup or structure changes.

## Where things are

| Where | What |
|---|---|
| [../specs/](../specs/) | What we are building, by phase (V1, V2, V3). The source of truth. |
| [../DESIGN.md](../DESIGN.md) | The visual design system. |
| [../agent_docs/](../agent_docs/README.md) | What has been built so far, feature by feature. |
| [research/](research/) | Investigation notes and RFCs. |
| [decisions/](decisions/README.md) | Architecture decision records (ADRs). |

## System overview

Dayboard is one Next.js 16 application (a modular monolith) with a PostgreSQL database. In production a Caddy reverse proxy terminates HTTPS in front of it, all three run with Docker Compose on one Linux VM, and GitHub Actions builds and deploys the image. Caddy, CI/CD, backups and rollback arrive with feature 06; today the app and database run locally and the production image can be built.

```text
Browser -> (Caddy, HTTPS) -> Next.js app -> PostgreSQL
                              |-- Better Auth (sessions, sign-in methods)
                              |-- Server Components (reads), Server Actions (writes)
                              |-- Route Handlers: /api/auth, /api/health (and AI streaming later)
```

**Run it locally:** follow [../README.md](../README.md) (install, `docker compose up -d db`, `pnpm db:migrate`, `pnpm dev`). It also covers tests, the production image and the Google, GitHub and email setup.

**How a request is trusted.** `src/proxy.ts` only checks that a session cookie exists and redirects if not. The real check is `requireUser()` in [../src/lib/session.ts](../src/lib/session.ts), called at the top of every page, layout, Server Action and Route Handler. Every query then filters by that user's id; no id ever comes from the browser.

**Where the code lives** (`src/`):

| Folder | What is there |
| --- | --- |
| `app/` | Routes. `(auth)` sign-in screens, `(onboarding)`, `(app)` the signed-in app, `api/` |
| `components/` | `ui/` primitives (reuse these), `layout/` shell, `auth/`, `settings/` |
| `actions/` | Server Actions, wrapped by `runAction` so they return results instead of throwing |
| `db/` | Drizzle client, `schema/`, `queries/` |
| `lib/` | `auth`, `session`, `env`, `errors`, `logger`, `email`, `dates`, `validations`, `redirects` |
| `styles/globals.css` | Every color, font and radius from [../DESIGN.md](../DESIGN.md) |

**Shared pieces to reuse, not rebuild:** see section 7 of [../CLAUDE.md](../CLAUDE.md).
