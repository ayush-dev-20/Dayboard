# Feature: Google Calendar

**Phase:** V2 (feature 12)
**Status:** In progress. Connecting, syncing, the event cache, Settings → Calendar, Today's events, the Calendar view overlay, work hours, busy windows for planning, and the server side of "create an event from a task" are built and tested **against the mock provider**. **Never run against the real Google API.** Not built: the offline cache, the time-block and create-event screens, the "different time" prompt, and Today's "Up next" rail.
**Date:** 2026-10-14

## What was built

- **Connect and disconnect** (`/api/calendar/google/connect`, `/callback`, `DELETE /api/calendar/account`). Separate from sign-in. PKCE, a signed httpOnly state cookie that names the user and expires in 10 minutes, `access_type=offline`, `prompt=consent`. Read scopes first; `?write=1` asks for the write scope on its own. The callback uses the session's person and refuses a wrong state, no cookie, a cookie made for someone else, or a reused code. Disconnect revokes at Google (best effort) and removes the account, calendars, events, links and waiting jobs at once.
- **Tokens:** the refresh token is sealed with AES-256-GCM (`src/lib/calendar/crypto.ts`), format `v1.<keyId>.<iv>.<ciphertext>.<tag>`, with the owner bound in as additional data. `TOKEN_ENCRYPTION_KEY_PREVIOUS` keeps an old key readable after a rotation. Access tokens are never stored.
- **Adapter** (`src/lib/calendar/types.ts`, `providers/google.ts`, `providers/mock.ts`): Google over `fetch`, no SDK. The mock has timed, all-day, tentative, free and recurring events at fixed UTC times, and scripted failures (`invalidGrant`, `expireSyncToken`, `failWith`).
- **Sync** (`sync.ts`, `handlers.ts`): a schedule fires `calendar.sync_all` every 15 minutes, which queues one `calendar.sync` per account. An account is leased (`sync_lease_until`) so two workers never sync it at once. Incremental by sync token; a 410 forces a full read of the window (−30 to +90 days). Cancelled and declined events are dropped. `invalid_grant` sets `NEEDS_RECONNECT`; rate limits and 5xx retry through the job backoff. Opening Today refreshes a calendar older than 5 minutes after the page is sent (`freshen.ts`). **Sync now** runs inline, six an hour.
- **Where events show:** Today ("Today's events", quiet when empty or not connected; a one-line reconnect note); the Calendar view through feature 06's overlay slot (read-only, with the calendar named in the accessible label); Plan my day.
- **Planning** (`planning.ts`, `busy.ts`): `PLAN_DAY_V2` gets the free windows of the working day. Tentative counts as busy; an all-day event blocks time only when it is marked busy. **Event titles go to the model only when "Let planning see event titles" is on.**
- **Create an event from a task (server only)** (`create-event.ts`, `POST /api/calendar/events`): needs the write scope, owner-checks the task and the calendar, derives a stable event id from a confirmation key so a retry makes no second event, and stores the link. No code path changes an event after a task changes.
- **Settings:** a Calendar tab (hidden unless configured), work hours in Productivity, the titles switch.

## Why

The product rule is that Dayboard never moves calendar events on its own, so everything here reads, and the one write is an explicit, confirmed create. Tokens are the sensitive part, so they are sealed, scoped to their owner and never reach the browser (`check:bundle` now looks for the key and the client secret).

## What was deferred

- **Offline cache** (Dexie `calendarEvents`, "as of 10:42"): feature 04's file (`src/lib/local/db.ts`) is being changed by another agent. Today needs a connection for events.
- **The time-block screen and the create-event dialog, the "Create events from tasks" switch, "Calendar event" on a task, the "different time, Update event / Leave as is" prompt and `POST /api/calendar/events/{id}/update`:** all touch the task detail, which feature 04 is refactoring. The server side of create is done and tested; `findFreeSlots` is ready for the time-block screen.
- **Today's "Up next" rail** merging the next event with scheduled tasks.
- **Plan my day proposal rows** with a suggested time slot (the model only learns the free windows).
- **Re-sealing old tokens** after a key rotation: `needsResealing` exists, nothing calls it.
- **E2E:** the offline case and the create-event flow (no screen yet).
- **Not run for real:** the Google adapter (sync-token behaviour with a time window, ID token claims, a 409 on a repeated event id), a real consent screen, Testing-mode 7-day expiry.

## Deviations from the spec

- Provider and status are `text` with a check, not enums (easier to extend). `calendar_sources` has its own `user_id`. `calendar_accounts` has `sync_lease_until`.
- The provider interface also has `authorizationUrl`, `exchangeCode` and `refreshAccessToken` (the spec lists four methods but needs these), and `createEvent` takes a stable `eventId`.
- An all-day event is stored as midnight UTC of its first day to midnight UTC after its last, and read by its UTC dates (Google's all-day dates have no zone).
- "Sync now" limits itself by writing a finished `calendar.manual_sync` row in `jobs` and counting them (the repo has no request log).
- The mock's consent screen is our own callback, so E2E runs the real connect and callback routes instead of an E2E-only route.
- **Fixed on the way:** `env-schema.ts` collected problems after the line that throws them, so a bad `WORKER_QUEUES` (feature 08) was never reported. All problems are now reported together. A test covers it.

## Related files

- `src/db/schema/calendar.ts`, migration `0015_google-calendar.sql` (tables, three `user_preferences` columns, the `calendar.sync_all` schedule).
- `src/lib/calendar/`: `crypto.ts`, `oauth.ts`, `normalize.ts`, `busy.ts`, `day.ts`, `store.ts`, `sync.ts`, `handlers.ts`, `manual.ts`, `freshen.ts`, `planning.ts`, `create-event.ts`, `providers/`.
- `src/app/api/calendar/**`, `src/app/(app)/settings/calendar/page.tsx`, `src/components/settings/calendar-settings.tsx`, `src/components/calendar/` (Today events, Google overlay), `src/components/views/use-calendar-overlay.ts`.
- Shared files touched (small edits): `today/page.tsx`, `calendar-view.tsx`, `calendar-overlay.ts`, `settings-tabs.tsx`, `productivity-settings.tsx`, `prompts.ts`, `plan-day/route.ts`, `builtin.ts`, `env-schema.ts`, `preferences.ts`, `validations/settings.ts`, `actions/settings.ts`.
- Tests: `tests/unit/calendar-pure.test.ts`, `calendar-day.test.ts`, `env.test.ts`; `tests/integration/calendar.test.ts` (23 cases); `e2e/calendar.spec.ts` (11 cases).

## Hand-off notes

- **To turn it on:** in Google Cloud, create an OAuth client (Web application) with the redirect `<app URL>/api/calendar/google/callback`, enable the Calendar API, and set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` and `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`). Without all of them the whole calendar UI is hidden. While the consent screen is in _Testing_, Google ends access every 7 days and the app shows "Reconnect".
- **Migration `0015`** is applied to the test database only. The dev database and Neon still need it (and dev still needs feature 10's `0014`, which needs pgvector).
- Tests: the mock is selected with `CALENDAR_PROVIDER=mock` (set in `vitest.integration.config.ts` and `playwright.config.ts`). In a test, `mockCalendar.behaviour` scripts failures.
- The jobs table is shared between test files. Tests that claim jobs by their own type should set stale foreign jobs aside first (see the "runs as a job" test), and compare run times with an explicit past `runAt` (the database clock has microseconds, the claim compares milliseconds).
- Related: `background-worker-and-jobs_v2.md`, `multiple-views_v2.md` (the overlay slot), `ai-writing-and-planning_v1.md` (Plan my day), `semantic-search_v2.md`.
