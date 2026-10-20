# Feature 14 — Push Notifications & Reminders

## 0. Reality check and progress (2026-10-19)

Checked against the code and `agent_docs/` before building. Every "Action" is the builder's proposal and can be vetoed.

| Spec says | What the project has | Action |
|---|---|---|
| Reuses feature 03's service worker "(push placeholder)" | `src/sw/sw.ts` has empty `push` and `notificationclick` listeners; its types declare only `push \| notificationclick` | Fill them in, add `pushsubscriptionchange`, and extend the worker's local event types |
| `push_subscriptions.device_id` is "the sync device id (05)" | That id lives only in the per-person Dexie database (`src/lib/local/workspace.ts`), and **nothing in the app opens the local workspace yet** (`openWorkspace` has no caller outside `src/lib/local`). A browser has no device id today | A push-only device id made on first use and kept in `localStorage`, sent on subscribe; a person's second subscription from the same device id replaces the first. When sync is wired in, adopt that id (one line). ADR 0013 |
| `task_reminders` "Syncable (05) so reminders set offline reach the server"; `reminder.set` operation | The sync protocol carries **tasks only**; todos, projects, tags and the rest are listed as gaps (`tests/unit/sync-change-log-coverage.test.ts`). No offline screen exists | Reminders are set with a Server Action and need a connection. Offline queueing is deferred with the rest of the offline entities; the table keeps `task_id`/`spec` so it can join the protocol later |
| In-app fallback "from the local database, so it works offline" | No local workspace runs in the app | The Today banner and nav count read the server's due reminders (loaded with the page, refreshed by a small route and a client timer). It keeps showing what was loaded while offline, but does not learn of new ones until the connection returns |
| Overdue summary job "daily at the person's start of day + 30 min" | Schedules are **global** (`every 5m`, `daily 03:00 UTC`); there is no per-person schedule | A seeded `overdue.scan` every 15 minutes queues one `overdue.summary` per person whose local start of day + 30 minutes has passed today (the same shape as feature 15's `review.scan`) |
| `notification.enqueue` helper for "weekly review ready (15), sync failure (05)" | Feature 15 left its seam at the end of `generateReview`. Feature 05's conflict records and sync status UI are **not built**, so nothing can raise a sync failure | Build the helper and the categories. Wire weekly review ready. `SYNC_FAILURE` has the category, switch and delivery path, and no producer yet; its switch is hidden until sync status exists (the spec's "only when those features are on") |
| Snooze token "single-use" | No store for used tokens in the spec's tables | The token binds the reminder id **and its `remind_at`**; a snooze moves `remind_at`, so the same token cannot be used twice. No new table |
| Subscribe needs "same-origin check and a double-submit token" | The repo's routes rely on a JSON content type (`readJson`) and Better Auth's `trustedOrigins`. No CSRF-token helper exists | Origin check plus a double-submit cookie token issued by `GET /api/notifications/vapid-key`, one helper (`src/lib/notifications/csrf.ts`) |
| `PushSender` interface with a `web-push` implementation and a mock | Calendar, storage and AI each have this shape, selected by `*_PROVIDER` / `E2E` in `src/lib/env-schema.ts` | Same: `PUSH_PROVIDER=mock` in tests and E2E; VAPID variables half-set fail at startup like calendar; `check:bundle` also looks for `VAPID_PRIVATE_KEY` |
| Subscription label parsing ("Chrome on Android") | `describeUserAgent` (`src/lib/user-agent.ts`, used by Settings → Account sessions) | Reused: `"{browser} on {device}"` |
| Quiet hours held "and delivered when the window ends" | Jobs have `run_at` and `RetryAfter`; the queue `notifications` exists (`QUEUES`) | A held delivery is re-queued with `runAt` = window end under a new dedupe key; the log row says `SUPPRESSED_QUIET` |
| "Calendar-related": a task linked to an event gets `CALENDAR_START` | `calendar_task_links (task_id, provider_event_id)` and `calendar_events` exist (feature 12), synced every 15 minutes | Computed from the linked event's start; recomputed when a sync moves it (the sync's upsert calls the same reconcile) |
| Recompute "when a task's date, time, status or the person's time zone changes" | Every task write passes through `logTaskUpserts` / `logTaskDeletes` (`src/lib/sync/change-log.ts`, 14 call sites, covered by a unit test); project moves and Trash purges write tasks directly | One `reconcileTaskReminders(tx, userId, ids)` called from those two helpers, so a new mutation cannot skip it; plus a call from the time-zone change and from the Trash purge |
| Settings → Notifications "new tab" | `settings-tabs.tsx` is a fixed list; App tab holds install state | New tab and page; the "This device" card reads the install state (`installView`) for the iOS message |
| E2E: "browser permission granted via Playwright context permissions with a fake subscription endpoint" | Headless Chromium has no push service, so `pushManager.subscribe` fails there | The E2E stubs `PushManager.subscribe` with an init script that returns a fixed fake subscription |
| Tick mode "delays delivery… document it" and spec 16 "say so in Settings" | Tick mode runs every five minutes from a GitHub workflow | The Notifications tab says reminders can arrive a few minutes late when the app has no worker running (shown when no worker heartbeat is fresh) |
| Packages: `web-push` after ADR 0013 | No ADR 0013 (the number is reserved by the feature README); `web-push` is not installed | ADR 0013 written first; `web-push` added |

**Progress (2026-10-20):** built and tested against the mock sender: the four tables, reminders that follow their tasks, delivery with quiet hours, categories, titles-off and the app-open check, devices (list, test, revoke, sign-out), the service worker handlers, Settings → Notifications, "Remind me", the Today banner and nav count, and the weekly review's ready notification. **Not built:** reminders set offline, a sync-failure producer, and the manual real-device checks. See `agent_docs/push-notifications-and-reminders_v2.md`.

---

## 1. Scope

- **Task reminders**, including a default lead time for tasks with a due time, custom reminders, snooze
- **Web Push** delivery to the person's devices, with a service-worker handler and deep links
- **Categories** with preferences: task reminders, calendar-related task reminders, sync failures, weekly review available, overdue summary
- **Devices:** enable on this device, list, test, revoke
- **Quiet hours** and per-category switches; titles-in-notifications choice
- An in-app fallback where push is unsupported, blocked, or the app is open
- Never a growth mechanic: no marketing, no re-engagement, no badges for their own sake

Reuses: feature 03's service worker (push placeholder) and install state, feature 08 worker and scheduler, feature 05 (sync failure signals), feature 12 (calendar-linked tasks and events), V1 task dates and times (`due_date`, `due_time`, `start_*`) and `src/lib/dates/*`, user preferences (time zone, start of day).

Packages: a Web Push library (`web-push`), after ADR 0013. VAPID keys in env.

Source spec sections: product §12, §4 (push where supported), §13; technical §11, §12, §13, §14; project plan Phase 9.

---

## 2. Data model

### `push_subscriptions`

| Column | Notes |
|---|---|
| `id`, `user_id` | user cascade |
| `device_id` | the sync device id (05), so one device has at most one subscription |
| `endpoint` | text UNIQUE (the push service URL) |
| `p256dh`, `auth` | text (encryption keys from the browser) |
| `user_agent_label` | short label ("Chrome on Android") for the device list |
| `created_at`, `last_seen_at`, `revoked_at` | |

Endpoints are unique across the table: registering an endpoint already owned by **another user** is refused and logged (a shared browser profile after sign-out must not deliver to the next person).

### `notification_preferences`

Per user, per `category` (enum `TASK_REMINDER, CALENDAR_REMINDER, SYNC_FAILURE, WEEKLY_REVIEW_READY, OVERDUE_SUMMARY`): `enabled` boolean (defaults: reminders on, sync failure on, weekly review on, overdue summary off), PK `(user_id, category)`. Plus on `user_preferences`: `quiet_hours_start`, `quiet_hours_end` (time, nullable), `default_reminder_lead_minutes` (default 15), `notify_show_titles` (default true).

### `task_reminders`

| Column | Notes |
|---|---|
| `id`, `user_id`, `task_id` (cascade) | |
| `remind_at` | timestamptz: the **computed instant** |
| `kind` | `DEFAULT_LEAD, CUSTOM, CALENDAR_START` |
| `spec` | jsonb: how it was defined (`{ type: "before", minutes }`, `{ type: "at" }`, `{ type: "day-before", time: "09:00" }`) so it is **recomputed** when the task's date or time changes |
| `status` | `PENDING, SENT, SNOOZED, CANCELLED` |
| `sent_at`, `snoozed_until` | |

Index `(status, remind_at)`. Syncable (05) so reminders set offline reach the server.

### `notification_log`

`id`, `user_id`, `category`, `dedupe_key`, `subscription_id` NULL, `status` (`SENT, FAILED, SUPPRESSED_QUIET, SUPPRESSED_PREF, EXPIRED`), `error_code`, `created_at`. **No title or body text.** Unique `(user_id, dedupe_key)` makes delivery idempotent. Used for observability and dedupe.

---

## 3. Reminders

- **Default reminders:** a task with a `due_time` (or `start_time`) gets a `DEFAULT_LEAD` reminder at that time minus the person's lead (default 15 minutes) when `TASK_REMINDER` is enabled. A task with only a date gets none (no surprise 9:00 pings); the **overdue summary** covers dates.
- **Custom reminder** (task detail → **Remind me**): at the due/start time, N minutes before (5, 15, 30, 60), the evening before at 18:00, or the day before at 09:00, or at a chosen date and time. Several per task allowed (max 3).
- **Recompute:** `computeRemindAt(spec, task, prefs)` (pure) runs when a task's date, time, status or the person's time zone changes. Done, cancelled, archived or deleted tasks cancel their reminders; reopening re-creates them. A reminder in the past is not created.
- **Time zones and DST:** computed in the person's time zone with `src/lib/dates`; "9:00 the day before" means 9:00 local even across a DST change; start-of-day rollover applies to "today".
- **Calendar-related:** a task linked to a calendar event (12) gets a `CALENDAR_START` reminder before the event starts (category `CALENDAR_REMINDER`), recomputed when the synced event moves.
- **Snooze:** from a notification action (+15 min) or in-app (15 min, 1 hour, tomorrow morning). A snoozed reminder returns to `PENDING` at the new time.

---

## 4. Delivery

### Jobs (feature 08)

| Job | Schedule | Purpose |
|---|---|---|
| `reminders.scan` | every 60 s | finds `PENDING` reminders with `remind_at <= now()`, enqueues `notification.deliver` per reminder with `dedupe_key = reminder:<id>:<remind_at>` |
| `notification.deliver` | on demand | applies preferences, quiet hours and the open-app check, then sends |
| `overdue.summary` | daily at the person's start of day + 30 min | one notification if `OVERDUE_SUMMARY` is on and there is something overdue or due today; skipped when there is nothing |
| `notification.enqueue` helper | from other features | weekly review ready (15), sync failure (05) |
| `notifications.prune` | daily | trims `notification_log` after 30 days |

Tick mode (08) delays delivery by up to the tick interval; document it in the deployment profile.

### Sending

- `PushSender` interface (`send(subscription, payload, options)`), with a real `web-push` implementation (VAPID `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and a `MockPushSender` that records calls.
- **Payload** (encrypted by the library, size-capped): `{ category, title, body, url, tag, reminderId?, token? }`. With `notify_show_titles` off the body is generic ("A task is due soon") so nothing private shows on a lock screen. `tag` collapses duplicates; `TTL` equals the remaining useful time (reminders 1 h, summaries 6 h); `urgency: normal`.
- **Responses:** `404` or `410` → mark the subscription `revoked_at`; `429`/`5xx` → retry with backoff (the job retries); other errors logged with the status only.
- **Suppression** rules, each logged as a status: category off, quiet hours (a notification inside the quiet window is **held** and delivered when the window ends; the overdue summary is dropped instead, because it is only useful at the start of the day), the task already done, and **the app is open and focused on that person's device** (an in-app banner replaces the push; the open check uses a recent `last_seen_at` heartbeat from the active tab).

### Service worker (extends feature 03)

- `push`: parse the payload, `showNotification(title, { body, tag, data: { url, token }, actions: [Open, Snooze 15 min] (where supported) })`. If the payload is unreadable, show a generic notification (never fail silently).
- `notificationclick`: **Open** focuses an existing window or opens `url` (`/tasks?task=<id>` and similar deep links, which route through sign-in when needed); **Snooze** calls `POST /api/notifications/snooze` with the signed `token` (valid 1 h, bound to the reminder and user) using the session cookie.
- `pushsubscriptionchange`: re-subscribe and re-register, and tell the server to replace the old endpoint.

---

## 5. Permission and device UX

**Settings → Notifications** (new tab):

- **This device:** status (not enabled, enabled, blocked in the browser, unsupported). **Enable notifications on this device** is a button the person presses; only then does the browser prompt (never on page load, never auto-requested, never nagged). Explains what will be sent in one sentence. On iOS, notifications only work for the **installed** app (iOS 16.4+): the card says so and links to the install steps from 03.
- **Categories:** a switch per category with a one-line description; weekly review and sync failure shown only when those features are on.
- **Quiet hours** (from/to), **default reminder lead**, **Show task titles in notifications**.
- **Devices:** a list of the person's subscriptions (label, added, last active, "This device"), each with **Revoke**; **Send a test notification**.
- **Revoke on sign-out:** signing out of a device unsubscribes it and tells the server.

**In-app fallback** (push unsupported, denied, or app open): due reminders appear as a quiet banner at the top of Today and a count on the Today nav item ("2 reminders"), with Snooze and Open actions; a local timer (from the local database, so it works offline) shows them at the reminder time while the app is open. No sound.

**Task detail:** a **Remind me** control showing existing reminders; chips like "15 min before".

---

## 6. Server contract

| Route / action | Purpose |
|---|---|
| `POST /api/notifications/subscribe` | `{ endpoint, keys, deviceId, label }` (session + CSRF protection: same-origin check and a double-submit token). Refuses an endpoint owned by another user. |
| `DELETE /api/notifications/subscriptions/{id}` | revoke (owner only) |
| `GET /api/notifications/subscriptions` | the person's devices |
| `POST /api/notifications/test` | sends a test to the current device (rate-limited 3/hour) |
| `POST /api/notifications/snooze` | `{ token }` → verifies and sets the new time |
| `setNotificationPreferences`, `setQuietHours`, `setReminderDefaults` | Server Actions |
| `setTaskReminders({ taskId, reminders })` / operation `reminder.set` | create/replace custom reminders (syncable, offline-capable) |
| `GET /api/notifications/vapid-key` | public key for subscription |

All owner-scoped, Zod-validated, rate-limited where noted. Errors use typed codes.

---

## 7. Security and privacy

- Subscription writes are **ownership-checked**: endpoints cannot be registered, listed or deleted across users; unique endpoints; CSRF protection on subscribe (technical spec §11).
- VAPID private key is server-only (not in the client bundle; the secret leak check covers it).
- Payloads carry the minimum; the titles-off setting hides task titles; payloads never contain note text.
- Snooze tokens are signed, expiring and single-use.
- Logs and `notification_log` hold ids and statuses, never text.
- No notifications for growth, tips or promotions; categories are exhaustive as listed.

---

## 8. Tests

**Unit**
- `computeRemindAt` for every spec type across time zones and DST transitions, start-of-day rollover, past times, recompute after date change, done/archived cancellation.
- Quiet-hours holding and dropping rules; preference gating; dedupe key stability.
- Payload builder: titles on/off, size cap; snooze token sign/verify/expire/single use.
- Subscription label parsing.

**Integration** (mock sender)
- **Ownership:** registering another user's endpoint is refused; listing and revoking only touch the caller's rows; cross-user snooze token rejected.
- `reminders.scan` + `notification.deliver`: a due reminder sends exactly once even with two workers or a re-run (dedupe); `410` revokes the subscription; `5xx` retries; category off and quiet hours suppress with the right log status; a done task suppresses.
- Overdue summary sends once per day only when there is something to say.
- Reminders set offline (operation) arrive and fire.
- Sign-out revocation removes the device.

**E2E**
1. Settings → Notifications: enabling asks only after the click (browser permission granted via Playwright context permissions with a fake subscription endpoint); the device appears; the test notification is recorded by the mock sender; revoke removes it.
2. Add a custom reminder to a task; change the due time; the reminder moves; complete the task; it cancels.
3. In-app fallback: with push disabled, a due reminder shows the Today banner with Snooze and Open (works offline).
4. Quiet hours hold delivery; per-category switches suppress.
5. iOS-not-installed explanation and unsupported-browser messages.
6. Axe, 360px, light and dark.

**Manual:** real Web Push on Chrome desktop, Android Chrome, and an installed iOS PWA (16.4+): permission, delivery, click-through, snooze action, revoke on `410`.

---

## 9. Definition of done

- [x] A task with a due time reminds the person on a device that enabled notifications; custom reminders, snooze and deep links work _(against the mock sender; a real device is a manual check)_
- [x] Preferences per category, quiet hours and titles-off all take effect; nothing is sent in a disabled category
- [x] Devices can be listed, tested and revoked; sign-out unsubscribes; one person can never receive another's notifications or manage another's subscriptions
- [x] Push failures degrade to in-app reminders; unsupported browsers see an honest explanation
- [x] Delivery is idempotent across workers and retries; expired subscriptions are cleaned
- [x] No marketing or growth notifications exist
- [x] VAPID keys never reach the client bundle
- [x] ADR 0013 written before building
- [x] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass _(2026-10-20: unit 1664, integration 521, E2E 312 + 153 across two runs; six flaky specs failed under load and passed alone)_
- [ ] `agent_docs/push-notifications-and-reminders_v2.md` written and indexed (with the manual device results) _(written and indexed; the manual device results are not in yet)_

---

## 10. Out of scope (V2)

Email or SMS notifications for reminders; notification centre history; recurring reminder rules independent of tasks; shared or team notifications; rich media notifications; badges; notifications while the person is signed out; periodic background sync.
