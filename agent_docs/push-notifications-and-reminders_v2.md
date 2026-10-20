# Feature: Push notifications and reminders

**Phase:** V2 (feature 14)
**Status:** In progress. Reminders, Web Push delivery, preferences, devices, the service worker handlers, the in-app reminders and the Settings tab are built and tested against the **mock sender**. **Never run against a real push service.** Not built: reminders set offline, the sync-failure producer, and the manual device checks.
**Date:** 2026-10-20

## What was built

- **Reminders follow their tasks.** A task with a due (or start) time gets a `DEFAULT_LEAD` reminder at the person's lead (15 min). A task with only a date gets none. A person can add up to three custom ones ("Remind me" on the task: at the time, 5/15/30/60 min before, the evening or the day before, or a chosen date and time). A task linked to a calendar event gets a `CALENDAR_START` one. `reconcileTaskReminders` (`src/lib/notifications/reminders.ts`) is the one place that decides what a task's reminders are; it is called from `logTaskUpserts` (so every task write runs it), from a time-zone change, from the preference writers, and from the calendar sync.
- **Delivery** (`deliver.ts`, `handlers.ts`, jobs on the `notifications` queue): `reminders.scan` every 60 s queues one `notification.deliver` per due reminder; the job applies the person's choices (category, quiet hours, the app being open), sends to each device, and writes a log row. Quiet hours **hold** a reminder (it waits as a snooze until the window ends); the overdue summary is dropped there. A done or archived task, or a reminder more than an hour late, is dropped (`EXPIRED`). `404`/`410` revokes the device; `429`/`5xx` retries through the job backoff.
- **Other notifications:** `enqueueNotification` (used by the weekly review's `generateReview` for a final review) and the `overdue.scan` job (every 15 min; queues the summary for people whose day started 30 minutes ago, who turned it on and have a device). `notifications.prune` trims the log (30 days), finished reminders (14 days) and old revoked devices.
- **Devices and the browser:** `push_subscriptions` (one live row per person and device id; an endpoint that another person owns is refused), Settings → Notifications (this device, categories, default reminder, titles, quiet hours, device list with test and revoke), the subscribe route with an origin check and a double-submit token, the heartbeat from an open tab, revoke on sign-out. The service worker (`src/sw/sw.ts`, rules in `src/sw/push.ts`) shows the notification (Open and Snooze 15 min on reminders), handles the click, and re-registers on `pushsubscriptionchange`.
- **In the app:** a quiet banner on Today for reminders that came due (Open, Snooze 15 min / 1 hour / tomorrow morning, dismiss), a bell count on the Today nav item, and a timer that shows the next one at its time.
- **Mock sender:** `PUSH_PROVIDER=mock` (always in E2E). Calls are recorded in memory, and in E2E also appended to `.e2e/push.jsonl` (`e2e/push-mailbox.ts`).

## Why

Reminders are the one place the app talks to the person when they are not looking, so the rules are strict: nothing is sent unless the person pressed Enable, what is sent is only what they switched on, and a lock screen can be made to show nothing private. ADR 0013 has the library and key decisions.

## What was deferred

- **Reminders set offline** (`reminder.set` as a sync operation, spec §2): the sync protocol carries tasks only and the app does not run the local engine yet. Reminders need a connection. The in-app list and nav count keep what was loaded while offline but learn nothing new until back online.
- **Sync failure notifications:** the category, delivery path and `enqueueNotification` exist; nothing raises one (feature 05's conflicts and status UI are not built) and the switch is hidden. Add the producer, then remove `SYNC_FAILURE` from `HIDDEN` in `notifications-settings.tsx`.
- **Manual checks on real devices** (spec §8): real Web Push on Chrome desktop, Android Chrome and an installed iOS PWA (16.4+): permission, delivery, click-through, the Snooze action, revoke on `410`. None done. `push` is covered in a real Chromium (a message delivered to the worker shows the notification); `notificationclick` (Open, Snooze) and `pushsubscriptionchange` run only on a real device; their decisions are unit-tested in `src/sw/push.ts`.
- **Not run against a real push service:** `web-push` is imported in `web-push-sender.ts` only and has never sent a real message here.

## Deviations from the spec

- Reminder statuses on a snooze: a snoozed (or quiet-hours-held) reminder keeps its own time in `remind_at` and waits in `snoozed_until` with status `SNOOZED`, so recomputing it from the task does not lose the snooze. The Snooze token binds the **send time** (`sent_at`), not `remind_at`, so it works once.
- Added: `acknowledged_at` on `task_reminders` (opened/dismissed in the app), a `SUPPRESSED_OPEN` log status, and `PUSH_PROVIDER`. Categories, kinds and statuses are `text` with a check, not enums.
- The device id is a push-only id kept in `localStorage` (and in a worker cache for `pushsubscriptionchange`), because the sync device id does not exist in the browser yet. Adopt it when sync is wired in.
- No per-person schedule: `overdue.scan` (every 15 min) replaces the spec's daily `overdue.summary`; the per-person delivery uses the `notification.deliver` job.
- A person with no push device has no log row for a reminder (it is only in-app).

## Related files

- `src/db/schema/notifications.ts`, migration `0018_push-reminders.sql` (four tables, four `user_preferences` columns, three schedules), `src/lib/notifications/` (`categories`, `remind-at`, `quiet-hours`, `payload`, `snooze-token`, `csrf`, `device-state`, `device-label`, `sender` + `web-push-sender` + `mock-sender` + `index`, `settings`, `subscriptions`, `reminders`, `deliver`, `handlers`, `enqueue`, `preferences`, `clock`, `client`, `push-keys`, `route-guard`).
- `src/app/api/notifications/**` (vapid-key, subscribe, subscriptions, test, snooze, heartbeat, reminders), `src/actions/notifications.ts`, `src/lib/validations/notifications.ts`.
- `src/sw/sw.ts`, `src/sw/push.ts`, `src/sw/policy.ts` (the push-device cache name).
- UI: `src/components/settings/notifications-settings.tsx`, `src/app/(app)/settings/notifications/page.tsx`, `src/components/tasks/remind-me.tsx`, `src/components/notifications/` (`reminder-banner.tsx`, `push-heartbeat.tsx`), `src/components/layout/sidebar-nav.tsx` (the bell count).
- Shared files touched: `src/lib/sync/change-log.ts` (the reconcile call), `src/lib/calendar/sync.ts`, `src/lib/review/service.ts` (the ready notification), `src/actions/settings.ts` (time zone), `src/db/queries/nav-counts.ts`, `src/lib/env-schema.ts`, `scripts/check-client-bundle.mjs`.
- Tests: `tests/unit/notifications-pure.test.ts`, `sw-push.test.ts`; `tests/integration/notifications.test.ts` (55 cases); `e2e/notifications.spec.ts` (15 cases, including the real service worker receiving a push through the browser's debugger).

## Hand-off notes

- **To turn it on:** `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` or `https:`). All three or none. **Keep the pair**: changing it ends every device's subscription. Without them, push is off and the UI says so; in-app reminders still work. Run a worker or tick mode (`reminders.scan` is a schedule); with tick mode reminders can be a few minutes late, and the settings page says so when no worker heartbeat is fresh.
- **Migration `0018`** is applied to the test database only. The dev database and Neon still need it (ask first for Neon).
- Tests set the clock the delivery job acts at through `notificationClock` (`src/lib/notifications/clock.ts`); nothing else changes it. The scan looks at everyone's reminders, so integration tests cancel all waiting reminders in `beforeEach`.
- A new way to change a task needs nothing: it already calls `logTaskUpserts`, which reconciles. A new reminder kind needs a branch in `reconcileTaskReminders` and the check in the migration.
- iOS only delivers to the installed app (16.4+); the page says so, and the install steps are in Settings → App (feature 03).
- Related: `pwa-shell-and-install_v2.md` (the worker), `background-worker-and-jobs_v2.md` (jobs, schedules, tick), `sync-engine_v2.md` (the missing offline path), `google-calendar_v2.md` (linked events), `ai-weekly-review_v2.md` (the ready notification), ADR 0013.
