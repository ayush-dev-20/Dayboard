# Feature: Foundation & Auth

**Phase:** V1
**Status:** Done (code, tests and docs). Real-provider checks and the Docker run are not yet verified; see "Not verified".
**Date:** 2026-10-01

## What was built
- The app skeleton: Next.js 16 + Tailwind v4 theme from `DESIGN.md`, Drizzle + PostgreSQL migrations, env validation, error model, logger, `/api/health`, seed script, Dockerfile and local Compose.
- Better Auth with email/password, Google, GitHub and magic link; `requireUser()`; onboarding; the app shell (sidebar, tablet sheet, phone bottom nav, theme); Settings (account, appearance, productivity, AI switch, delete account).
- 88 unit tests and 57 Playwright tests, all passing, run against a production build.

## Why
Every later feature needs a signed-in user, a database and a shell, so this is the one base. Better Auth (self-hosted, our Postgres) was chosen over Clerk and Auth.js; reasoning is in `specs/v1/features/01-foundation-and-auth.md` §2.

## What was deferred
- Quick capture, Create and the search trigger are visible but **disabled** until features 02 and 04. Sidebar counts need real data.
- Settings **Tags** tab: built in feature 03. AI **usage meter** and provider name (feature 05). Session **location** (needs a GeoIP service). Provider rows show "Linked on {date}", not the provider email.
- Production Compose, Caddy, CI/CD, backups, rollback: feature 06. `motion` and `cmdk` are not installed yet.

## Related files
- `src/lib/session.ts`: `requireUser()`, the only way to get the user. `src/lib/auth.ts`: Better Auth config.
- `src/proxy.ts`: cookie-presence redirect; sets `x-next-path` and `x-request-id`. Never the real access check.
- `src/actions/settings.ts`, `onboarding.ts`: Server Actions (`runAction` in `src/lib/actions.ts` wraps them).
- `src/db/schema/` (auth tables, `user_preferences`), `src/db/queries/sessions.ts`, `drizzle/migrations/`.
- `src/styles/globals.css`: all design tokens. `src/components/ui/`: primitives to reuse.
- `e2e/` and `tests/unit/`; `scripts/migrate.ts`, `scripts/seed.ts`.

## Hand-off notes
- **Better Auth `listSessions` and `unlinkAccount` demand a session under 10 minutes old.** Calling them from a page crashed Settings for anyone signed in longer. Sessions are read from the table instead (`db/queries/sessions.ts`); unlinking checks freshness first and shows "Sign in again". Check any new Better Auth call for this before using it in a page.
- **Rate limits are keyed by client IP from `X-Forwarded-For`.** With no header, every visitor shares one bucket. Caddy (feature 06) must set it, and the app must only be reachable through Caddy. Tests give each test its own fake IP. The magic-link plugin has its own default limit (5 per minute on verify).
- Better Auth replaces any `?error=` on `errorCallbackURL` with its own code (`INVALID_TOKEN`, `account_not_linked`, ...); the sign-in page maps those.
- Account linking is safe against pre-registered passwords: Better Auth 1.7 refuses to link a provider to an account whose email was never verified (`requireLocalEmailVerified`, on by default). Don't turn it off.
- `E2E=true` means "console email in a production build, emails written to a file". It is test-only; `env-schema.ts` requires Resend in real production.
- `next dev` used to append a block to `CLAUDE.md`; `agentRules: false` in `next.config.ts` stops that. Keep it.
- Pins: TypeScript **6.0** (see ADR 0001), ESLint 9, `@better-auth/utils` 0.4.2 (matches `better-auth`; pnpm resolved 0.5.0 by default and loaded two copies).
- **Fonts:** the app now uses Inter everywhere (ADR 0003); `DESIGN.md` and `CLAUDE.md` still name Newsreader and IBM Plex until the owner updates them. Code is the source of truth.
- IDs are UUID v7 from `src/lib/ids.ts`, including Better Auth's tables. Generated `auth.ts` schema was edited to `timestamptz`; re-apply if regenerated.
- **Design vs DESIGN.md:** the Settings design uses top tabs with Danger zone inside Account; DESIGN.md describes a left list and a separate section. The design was followed. Today is a greeting plus empty state until feature 04.
- The repo is not a git repository yet (no `.git`); `husky` is set to tolerate that.

## Not verified
- Google and GitHub sign-in and account linking (no credentials were available); checklist is in `README.md`.
- Real Resend delivery (tests use the console sender).
- `Dockerfile` and `docker-compose.yml` were written but **not run**: Docker is not installed on the development machine. What was checked instead: a build with no env vars, the standalone server on its own, and the bundled migration runner under plain `node`.
