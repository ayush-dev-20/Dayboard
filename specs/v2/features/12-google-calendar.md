# Feature 12 — Google Calendar

## 1. Scope

- **Connect and disconnect** a Google account for calendar access (separate from sign-in), with least-privilege scopes
- **Read events** from selected calendars, cached and refreshed by the worker
- Show events in **Today**, in the **calendar view** (06) and in **planning**
- An optional **task time block**: give a task a start and end time in a free slot
- **Create a calendar event from a task** only after confirmation
- Feed **busy windows** to AI planning (Plan my day, weekly review)
- A calendar **adapter** interface with a Google implementation and a mock

Reuses: Google sign-in (identity only today), feature 08 jobs, feature 05 data (tasks have `start_date`, `start_time`, `due_date`, `due_time`), feature 06 calendar view overlay slot, V1 Today page and Plan my day, `src/lib/dates/*`, the AI prompts for planning.

Source spec sections: product §8, §2.1 row 6, §13; technical §8, §13; project plan Phase 7.

Rule from the product spec: **do not automatically move calendar events**. Tasks never change events on their own.

---

## 2. Data model

### `calendar_accounts`

| Column | Notes |
|---|---|
| `id`, `user_id` | user cascade |
| `provider` | enum `GOOGLE` (room for others) |
| `provider_account_id` | Google's stable id (`sub`) |
| `email` | display only |
| `refresh_token_enc` | text: the refresh token **encrypted** with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`; format `v1.<keyId>.<iv>.<ciphertext>.<tag>` so keys can rotate |
| `scopes` | text[] granted |
| `status` | `ACTIVE \| NEEDS_RECONNECT \| REVOKED` |
| `connected_at`, `last_synced_at`, `last_error` | |

Access tokens are short-lived and held **in memory only** by the worker or request that needs them (never stored, never sent to the browser). Unique `(user_id, provider, provider_account_id)`.

### `calendar_sources`

`id`, `account_id` (cascade), `provider_calendar_id`, `name`, `color`, `time_zone`, `selected` (bool), `sync_token` (Google incremental sync token), `last_synced_at`.

### `calendar_events` (cache)

| Column | Notes |
|---|---|
| `id`, `user_id`, `source_id` (cascade) | |
| `provider_event_id`, `ical_uid` | unique `(source_id, provider_event_id)` |
| `title`, `location` | text (private; same sensitivity as notes) |
| `start_at`, `end_at` | timestamptz; `all_day` boolean; `time_zone` |
| `busy` | boolean (Google `transparency = opaque`, not declined) |
| `status` | `confirmed \| tentative \| cancelled` |
| `html_link` | link to open the event in Google |
| `recurring_event_id` | for series |
| `updated_at` | |

The cache holds **−30 days to +90 days** around today per selected calendar; older rows are pruned by the sync job. Recurring events are stored as Google's expanded instances (`singleEvents=true`).

### `calendar_task_links`

`task_id` (cascade), `user_id`, `source_id`, `provider_event_id`, `created_at`. Created when an event is made from a task; used to show "Calendar event" on the task and to warn when the task's time differs later. PK `(task_id, provider_event_id)`.

### Preferences

`user_preferences.work_start` and `work_end` (`time`, defaults 09:00 and 18:00) used for free-slot suggestions and planning; added to Settings → Productivity.

### Local (Dexie)

`calendarEvents` for the visible window (read-only) so Today shows the last synced events offline with "as of 10:42".

---

## 3. OAuth connection

Not Better Auth sign-in. A dedicated flow so calendar access is explicit and revocable:

- `GET /api/calendar/google/connect` (session required) → builds the Google authorization URL with **PKCE**, a signed `state` bound to the user id and a short expiry (stored in an httpOnly cookie), `access_type=offline`, `prompt=consent`, and `include_granted_scopes=true` (incremental).
- `GET /api/calendar/google/callback` → verifies `state` and PKCE, exchanges the code (server-side, with the client secret), reads the account id and email from the ID token, encrypts and stores the refresh token, lists calendars, selects the primary by default, enqueues the first sync, redirects to Settings → Calendar.
- **Scopes (least privilege), requested incrementally:**
  1. Read: `calendar.calendarlist.readonly` and `calendar.events.readonly`.
  2. Write, only when the person turns on "Create events from tasks": `calendar.events` (a separate consent screen).
- **Disconnect:** revokes the token at Google (best effort), deletes the account, sources, cached events and links, and cancels the account's jobs. The person is told it takes effect immediately.
- **Errors:** `invalid_grant` (expired or revoked) sets `NEEDS_RECONNECT` and shows a "Reconnect Google Calendar" banner in Settings and a quiet note on Today; nothing else breaks.

**Google verification and the 7-day token limit.** While the OAuth consent screen is in *Testing*, Google expires refresh tokens after **7 days** and caps test users. For a personal deployment this is expected: the app must treat `NEEDS_RECONNECT` as normal and make reconnecting one click. Moving to a verified production app is a separate, owner-driven step (these are sensitive scopes) and is documented in the deployment docs, not built here.

Env: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` (can reuse the sign-in client with added redirect URI), `TOKEN_ENCRYPTION_KEY` (32 bytes, base64; required when calendar is enabled), `GOOGLE_CALENDAR_REDIRECT_URI`. With none set, all calendar UI is hidden.

---

## 4. Adapter

```ts
interface CalendarProvider {
  listCalendars(account: Credentials): Promise<ProviderCalendar[]>;
  listEvents(account: Credentials, source: Source, range: DateRange, syncToken?: string): Promise<{ events: ProviderEvent[]; nextSyncToken?: string; fullSync: boolean }>;
  createEvent(account: Credentials, source: Source, input: CreateEventInput): Promise<ProviderEvent>;
  revoke(account: Credentials): Promise<void>;
}
```

`GoogleCalendarProvider` (REST via `fetch`, no Google SDK needed) and `MockCalendarProvider` (fixture events with all-day, recurring, tentative, declined, cross-time-zone cases, plus failures such as `invalid_grant` and 410 sync-token expiry). Provider code stays in `src/lib/calendar/providers/`; the domain code never imports it directly.

---

## 5. Sync job (feature 08)

- `calendar.sync` per account every **15 minutes** (schedule) and on demand (`syncNow` when Today is opened and data is older than 5 minutes; Settings "Sync now"). Incremental via `sync_token`; a **410** forces a full window refresh.
- Normalises events: all-day to the person's day, time zones to instants, drops cancelled and declined, marks `busy`. Upserts and deletes in a transaction; pruning outside the window.
- Rate limits and quotas: exponential backoff on 429/5xx; per-account lock so two workers never sync the same account at once.
- Logs carry account ids and counts, **never event titles or tokens**.

---

## 6. Where events appear

### Today

A **Today's events** section above the task lists: time, title, a muted "all day" row, the calendar colour as a small dot (with the calendar name available on hover, not colour-only). Tentative events are italic with "Maybe". Quiet when empty or not connected (a one-line "Connect Google Calendar" link appears once in Settings, not on Today). Today's right rail "Up next" merges the next event with scheduled tasks. Events open in Google (`html_link`, new tab). Offline shows the cached events with their age.

### Calendar view (06)

Registers an overlay provider: events as quiet, read-only blocks (no drag), distinct from tasks by style, clipped to the day cell, with the calendar name in the accessible label.

### Planning (Plan my day, weekly review)

`getBusyWindows(userId, range)` returns merged busy intervals (tentative counts as busy; all-day events do not block time unless they are marked busy) in the person's day. The **Plan my day** prompt (`PLAN_DAY_V2`) receives free windows between `work_start` and `work_end` (not event titles by default; titles only if the person turns on "Let planning see event titles") and the proposal rows may show a suggested time slot. **Planning still sets no times automatically**: the person confirms, and time blocks are an explicit action (below).

---

## 7. Time blocks and creating events

### Time block on a task

- **Block time** on a task detail (and from a Plan my day proposal): shows suggested free slots for a chosen duration (default 30 min or the task's estimate if present), a time picker, and **Set time block**. It writes the task's `start_date`/`start_time` and `due_date`/`due_time` (existing fields) in the task's own timeline. It does **not** touch Google unless the next step is used.
- `findFreeSlots(busy, duration, workStart, workEnd, day)` is a pure function (tested).

### Create a calendar event from a task (confirmation required)

1. Available only when write access is granted and the task has a start and end (or a due date and time).
2. **Confirm dialog:** title, date and time, calendar to use, a link back to the task in the description, optional reminder; **Create event**. A short "Needs a connection" state when offline (this action is online-only).
3. `createEvent` via the adapter; stores a `calendar_task_links` row; the task shows "Calendar event" with an open-in-Google link.
4. If the task is later rescheduled, the task shows "The calendar event has a different time. [Update event] [Leave as is]" and does **nothing** until chosen (no automatic moves).

---

## 8. Server contract

| Route / action | Purpose |
|---|---|
| `GET /api/calendar/google/connect`, `GET …/callback` | OAuth flow (§3) |
| `GET /api/calendar/status` | accounts, calendars, selection, last sync, status |
| `POST /api/calendar/calendars` | `{ sourceId, selected }` selection |
| `GET /api/calendar/events?from=&to=` | cached events for a range (owner, max 62 days), `no-store` |
| `POST /api/calendar/sync` | on-demand sync (rate-limited 6/hour) |
| `POST /api/calendar/events` | create from a task: `{ taskId, sourceId, start, end, reminderMinutes? }`, requires write scope, owner-checks the task, idempotency key |
| `POST /api/calendar/events/{id}/update` | update a created event after confirmation |
| `DELETE /api/calendar/account` | disconnect |
| `setWorkHours`, `setPlanningSeesTitles` | Server Actions in settings |

All start with `requireUser()`, validate with Zod, scope by user, and never return tokens.

---

## 9. UI: Settings → Calendar

Connect button with a plain permission explanation ("Dayboard will read your events. It won't change them unless you create an event from a task."), connected account and email, calendar list with checkboxes, last sync and **Sync now**, "Create events from tasks" switch (asks for the extra scope), "Let planning see event titles" switch, working hours, **Disconnect** (confirm; says all calendar data on Dayboard is removed), reconnect banner when needed, the Testing-mode explanation when relevant.

---

## 10. Security and privacy

- Refresh tokens encrypted at rest; access tokens in memory only; never in `localStorage`, cookies readable by scripts, logs or responses.
- `state` and PKCE verified; redirect URI exact-match; the callback ignores any `user_id` supplied by the browser (uses the session).
- Scope minimisation and incremental consent; the write scope is requested only when enabled.
- Every query by `user_id`; events and links of other people are unreachable.
- Event titles are private data: not logged, not sent to the AI planner unless the explicit setting is on.
- Disconnect and account deletion wipe tokens and cache.

---

## 11. Tests

**Unit**
- Token encryption round trip, key rotation (`keyId`), tamper detection.
- Event normalisation: all-day, time zones across DST, recurring instances, cancelled/declined/tentative, busy flag.
- `mergeBusy` and `findFreeSlots` (overlaps, edges, work hours, all-day, day boundaries, start-of-day rollover).
- OAuth state and PKCE helpers; scope upgrade logic.

**Integration** (mock provider)
- Connect callback with a bad `state` or reused code is refused; tokens stored encrypted; calendars listed.
- Sync inserts, updates, deletes; 410 triggers full refresh; `invalid_grant` sets `NEEDS_RECONNECT` and nothing else fails.
- Ownership: another person's account/source/event ids are `NOT_FOUND`; events endpoint never returns another user's rows.
- Create-event requires write scope and an owner-checked task; idempotent on retry; link stored; no automatic update when a task changes.
- Disconnect removes tokens, sources, events, links, jobs.
- Plan my day prompt includes free windows, excludes titles by default.

**E2E** (mock provider; connect simulated through an E2E-only callback)
1. Connect, select calendars, events show in Today with times; all-day and tentative styles.
2. Calendar view overlay shows events read-only.
3. Block time on a task using a suggested slot; Plan my day proposals avoid busy windows.
4. Create an event from a task: confirm dialog, link appears; reschedule the task → "different time" prompt, event untouched until chosen.
5. Reconnect banner after `invalid_grant`; Disconnect wipes data.
6. Offline Today shows cached events with their age; create is disabled offline.
7. Axe, 360px, light and dark.

---

## 12. Definition of done

- [ ] A person can connect and disconnect Google Calendar; tokens are encrypted and never reach the browser
- [ ] Events from selected calendars show in Today, the calendar view and planning (busy windows) and stay fresh through the worker
- [ ] A task can get a time block, and an event can be created from a task only after confirmation; no event is ever moved automatically
- [ ] Expired or revoked access is recoverable in one click and breaks nothing else
- [ ] Event titles are private: not logged, not sent to AI unless the person opts in
- [ ] Without configuration, calendar UI is hidden and the app is unchanged
- [ ] CI runs on the mock provider; no Google calls
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass (no calendar secrets in the bundle)
- [ ] `agent_docs/google-calendar_v2.md` written and indexed

---

## 13. Out of scope (V2)

Other calendar providers; two-way sync of event edits; moving, deleting or accepting events; creating invitations or inviting people; free/busy of other people; Google verification of the OAuth app; calendar notifications beyond feature 14's reminders.
