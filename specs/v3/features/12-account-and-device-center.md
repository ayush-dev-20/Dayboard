# Feature 12 — Account & Device Center, Data Export and Deletion (V3)

> **Build position: twelfth V3 feature** (V3 plan phase 9). It can start earlier, because the sessions part needs only V1; the export and deletion parts need the worker (V2 feature 08) and the earlier V3 data. Behaviour is in V3 product spec §14 (Account/device management) and technical spec §14 and §15. Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

**Already built in V1 (feature 01), and kept:** the Sessions list (`sessions-section.tsx`: a device label from `describeUserAgent`, browser, last active, "this device"), **Sign out one session** and **Sign out all other sessions** (`revokeSession`, `revokeOtherSessions` in `src/actions/settings.ts`, using Better Auth), and **Delete account** (`deleteAccount`: typed confirmation, a session at most 10 minutes old, then the user row and everything cascading from it).

**New in this feature:**

- **Devices:** a device is more than a session. It has a name the person can change, a first and last seen time, its sessions, and its push state. The list shows devices, with their sessions inside.
- **Notification devices:** which devices receive push (V2 feature 14), with a per-device switch.
- **Recent security activity:** a short log of sign-ins, session revocations, password and email changes, exports and deletion requests.
- **Data export:** a person can download their whole workspace.
- **Account deletion made safe and complete:** a short grace period, a full sweep (files, shared content, other people's references), and a minimal completion record.
- **AI summary on the Account page** (read-only): AI on or off, which features were used and how often this month, and links to Memory and the agent settings. *AI provider keys per person are out of scope (§9).*

Reuses: Better Auth (`auth.api.listSessions`, `revokeSession`, `revokeOtherSessions`, session freshness via `freshAge` / `FRESH_SESSION_SECONDS`, `deleteUser`), `describeUserAgent`, the settings tab layout, V2 feature 14's `push_subscriptions` (when it exists), V2 feature 09's storage service (`getStorage`, keys `u/{userId}/…`), V2 feature 08's jobs, `ai_usage`, `EmailSender`, `ConfirmDialog`.

Packages: `fflate` (MIT, 0.8.3 on npm when this was written) for building the export ZIP in the worker, after ADR 0023 compares it with `archiver` (MIT, heavier, Node streams) and a hand-rolled store-only ZIP. The deletion and device parts add none.

Source spec sections: V3 product §14, technical spec §14 and §15, UI/UX spec §12, `../Agent.md` §11 (account deletion and export tests).

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Devices table and naming, session↔device link, the Devices section replacing the Sessions list, security activity | Know and manage your devices |
| **B** | Export job and download | Take your data with you |
| **C** | Deletion with grace period and full sweep, completion record, notification-device switches (when V2 14 exists) | Leave cleanly |

---

## 2. Data model

### `devices` (new)

| Column | Notes |
|---|---|
| `id` | uuid PK: **generated on the device** (UUID v7, kept in `localStorage`, later IndexedDB with V2 feature 04), so it is the same `device_id` that V2 sync and push use |
| `user_id` | cascade |
| `name` | text ≤ 60: defaults to `describeUserAgent` ("Safari on iPhone"), editable |
| `platform` | text: `describeUserAgent().device` at last sign-in |
| `first_seen_at`, `last_seen_at` | `last_seen_at` is updated at most once an hour per device |
| `revoked_at` | NULL while active |

### `session_devices` (new)

`session_id` text PK → the Better Auth `session` row (cascade), `device_id` uuid → `devices` (cascade). Better Auth's session table is not altered; this side table links a session to a device. A session with no row shows as "Unknown device".

How the link is made: the client sends its `device_id` in an `x-device-id` header on the first authenticated request of a session (a tiny client call from the app shell, not on every request). The server upserts the device (checking that an existing id belongs to this person; an id owned by someone else is ignored and a new one is issued) and writes `session_devices`. The id is never trusted as authentication.

### `security_events` (new)

`id`, `user_id` (cascade), `kind` (`SIGN_IN`, `SESSION_REVOKED`, `OTHERS_REVOKED`, `PASSWORD_CHANGED`, `EMAIL_CHANGED`, `PROVIDER_LINKED`, `PROVIDER_UNLINKED`, `EXPORT_REQUESTED`, `EXPORT_DOWNLOADED`, `DELETE_REQUESTED`, `DELETE_CANCELLED`), `device_label` text ≤ 80 (the preformatted label, not the raw user-agent), `ip_prefix` text NULL (IPv4 `a.b.c.0`, IPv6 first 48 bits, to help recognise a sign-in without storing a full address), `created_at`. Kept 90 days (job; lazy delete on read until the worker exists). No IP geolocation service is used.

### `data_exports` (new)

`id`, `user_id` (cascade), `status` (`QUEUED`, `RUNNING`, `READY`, `FAILED`, `EXPIRED`), `object_key` (in the storage service under `u/{userId}/exports/…`), `size_bytes`, `error_code`, `requested_at`, `ready_at`, `expires_at` (24 hours after ready), `download_count`.

### `pending_deletions` and `deletion_ledger` (new)

The ledger deliberately has **no foreign key and no user id**, so it survives the user row without keeping personal data.

- `pending_deletions`: `user_id` PK (cascade), `requested_at`, `execute_after` (7 days), `cancelled_at`.
- `deletion_ledger`: `id`, `deleted_at`, `reason` (`USER_REQUEST`), nothing else: **no user id, no email, no name**. It proves the sweep ran (and counts them) without keeping personal data.

### `user_preferences`

No change here (feature 09 adds the agent switches; feature 10 has its own table).

Migration: expand-only (new tables).

---

## 3. Devices and sessions

- The **Devices** section (Settings → Account, replacing the Sessions list; the old actions keep working) lists each device: name (editable inline), platform, "This device" marker, last seen ("2 hours ago"), the number of active sessions, **Sign out** (revokes that device's sessions), and **Remove device** (revokes its sessions, deletes its push subscription, marks it `revoked_at`; once V2 feature 04 exists the next contact from that browser also clears its local database). A device with no active sessions and no push is dimmed under "Past devices" and can be forgotten.
- **Sign out all other devices** stays one click and uses Better Auth's `revokeOtherSessions`; it asks for no re-sign-in (it only reduces access) but records a security event.
- **Sensitive actions need a fresh session** (the existing 10-minute rule, `FRESH_SESSION_SECONDS`): requesting an export, starting deletion, changing email or password, and removing a device that is not the current one. A stale session is answered with the existing "sign in again" flow (`reauth-notice.tsx`).
- Last active comes from the session's `updatedAt`. Better Auth only refreshes it every `updateAge` (24 hours today, `src/lib/auth.ts`), so the label is accurate to about a day; lowering `updateAge` to 1 hour is an option to decide during the build and costs one extra write per hour per session (unverified).

---

## 4. Security activity

A short list under Devices: "Signed in from Safari on iPhone, 3 hours ago", "Signed out all other devices", "Password changed", "Export requested". Entries come from Better Auth hooks and from our own actions; they are written after the fact in the same request. The text never includes email addresses or tokens. Unrecognised sign-ins are not scored or blocked in this feature; the person can see them and use *Sign out all other devices*. (Abuse detection and new-device emails are in feature 13's security work.)

---

## 5. Notification devices (needs V2 feature 14)

When push exists, each device row shows **Notifications: On / Off** with a switch (turning it off deletes that device's subscription), and a hint if the browser blocked permission. Until V2 feature 14 is built the section is hidden. Nothing here sends a notification.

---

## 6. Data export

**What goes in** (one ZIP, built by the worker job `account.export`, written to storage, not streamed through a request):

| Path | Content |
|---|---|
| `README.txt` | what is inside and how to read it |
| `notes/{title}-{id}.md` | each note as Markdown (the app's own Markdown writer, `src/lib/editor/markdown.ts`), with a front-matter block: id, created, updated, project, tags, links |
| `journal/YYYY-MM-DD.md` | journal entries, the same way |
| `tasks.json`, `todos.json`, `projects.json`, `tags.json` | full records |
| `canvases/{title}-{id}.excalidraw` | each canvas as an Excalidraw file |
| `templates.json`, `memories.json` | the person's own |
| `comments.json` | comments the person wrote (their own text, with the item id) |
| `automations.json`, `agent-runs.json` | definitions and run goals and answers |
| `files/…` | attachments the person owns (V2 feature 09), at their original names; skipped with a note in `README.txt` if storage is unavailable |
| `account.json` | profile, preferences, device list (names only) |

**Never included:** other people's content (even if shared with the person), session tokens, password hashes, provider tokens, other people's comments, audit rows of others. Items the person shares with others are included as the owner's own.

**Flow:** `requestExport()` (fresh session required) creates a `data_exports` row and queues the job. The job reads everything with the person's own access, builds the ZIP with `fflate` in bounded memory (files are added in streaming chunks; a single export is capped at **2 GB**, over which files are listed but not included), writes it to `u/{userId}/exports/{id}.zip`, sets `READY`, and sends an email (no content) with a link to the Account page. **Download** is a Route Handler `GET /api/account/export/{id}` that checks the session user owns it, that it is `READY` and unexpired, and redirects to a short-lived signed storage URL (as feature 09 does for files). The file and row are removed after 24 hours by the prune job.

Limits: one export every 24 hours per person; one running at a time.

---

## 7. Account deletion

Today `deleteAccount` removes the user immediately. This feature keeps the typed confirmation and the fresh-session rule, and changes what happens next:

1. **Request:** the person confirms (typed email or the word DELETE, as now). The server writes `pending_deletions` (`execute_after` = 7 days), signs out **every** session, and sends a confirmation email (no content) with a **cancel** link.
2. **Grace period:** signing in again shows a banner "Your account is scheduled for deletion on <date>. **Cancel deletion**" and nothing else changes. Cancelling sets `cancelled_at` and records a security event.
3. **Sweep** (job `account.delete`, at `execute_after`, idempotent, resumable):
   - Delete objects under `u/{userId}/` in storage (files and exports).
   - **Shared content:** items the person owns and shared are deleted with them (grants and invitations cascade); collaborators see "no longer available". Items they were merely granted are untouched.
   - **Contributions to other people's items** (feature 04 and 06): `created_by_user_id` / `updated_by_user_id` set to NULL; comments are kept and shown as "Former member".
   - Remove the user row through Better Auth (`deleteUser`), which cascades to sessions, accounts and every table with `user_id ... ON DELETE CASCADE`: tasks, todos, notes, projects, tags, canvases, templates, memories, automations, agent runs, events, notifications, devices, security events, audit rows, AI usage, preferences.
   - Insert one `deletion_ledger` row (no personal data).
4. **Verification:** a test seeds every table, deletes a user, and asserts that **no row anywhere holds that user id** and no storage key under their prefix remains. A new table with `user_id` and no cascade fails the build (a schema test lists all tables with a `user_id` column).

Audit records: the person's own audit and security rows are deleted with them (they are personal data). The ledger keeps only the fact that a deletion happened.

An operator cannot restore a deleted account; backups age out on their own schedule (feature 13 states the retention).

---

## 8. UI

Settings → **Account** keeps profile, sign-in methods and password. New or changed sections, in order: **Devices** (§3, replacing Sessions), **Recent security activity** (§4), **Your data** (Export: button, status, download link with expiry; Delete account with the grace-period text), **AI** summary (read-only counts for the month by feature, links to Settings → AI and Memory, plus the agent switches from feature 09). The Settings tab strip is unchanged (no new tab).

- Plain words throughout; no session tokens, ids or raw user-agent strings are shown.
- Destructive buttons use the existing `ConfirmDialog` and the existing re-sign-in flow.
- Phone: sections stack; the device list is rows with a `…` menu at 44 px targets.
- Accessibility: statuses are text; the export status is announced politely; the deletion banner is a labelled region; focus is managed in dialogs.

---

## 9. Rules

- **Better Auth is the only auth.** Use its APIs for sessions and deletion; do not write to its tables directly, and do not add another way to sign someone in or out.
- **Device ids are labels, not credentials.** They never authorise anything.
- **Fresh session for sensitive actions,** enforced on the server by the same helper as today.
- **Export contains only the person's own data,** assembled with their own access checks; it is built by a job, never inside a request.
- **Deletion is complete or it is not done:** the sweep is resumable and the test above is part of the definition of done.
- **No content in logs, emails or the ledger.** Emails say that an export is ready or a deletion is scheduled, nothing else.
- **No new sign-in methods, no per-person AI provider keys** (storing third-party secrets needs encryption at rest and its own ADR). The AI summary is read-only.
- **Rate limits:** device rename 30 per hour, export 1 per day, deletion requests 3 per day.

---

## 10. Tests

**Unit**: device label defaults and the IP prefixing (IPv4 and IPv6); the freshness check; the export manifest builder (paths unique, sanitised file names, no path traversal from titles); the 2 GB cap logic; deletion date calculation.

**Integration** (real database, mock storage and email)
- Device linking: a new session creates a device; an id owned by another person is ignored; sign out of a device revokes only its sessions; remove device deletes push and marks it revoked; ownership matrix for every action.
- Sign out others keeps the current session; a stale session gets the re-auth error for export, delete and device removal.
- Security events are written for each action, hold no email or token, and are pruned after 90 days.
- **Export:** a seeded workspace produces a ZIP with the expected entries; another person's data (including shared items) is absent; notes round-trip as Markdown; a failed storage write marks `FAILED`; the download route refuses another person's id, an unready or expired export; one export per day.
- **Deletion:** the full-sweep test (all tables, storage prefix); cancel during grace; the job is idempotent when interrupted; shared items disappear for collaborators; their contributions to others' items survive as "Former member"; the ledger row contains no personal data; the schema test for `user_id` cascades.

**E2E**
1. Sign in on two browser contexts; rename one device; sign out the other from the first; the second is signed out on its next request.
2. Request an export (mock worker): the Account page shows Ready, the download opens a ZIP with a README and notes.
3. Request deletion: signed out everywhere; signing in shows the banner; cancel restores normal use; request again and run the job: the account is gone and sign-in fails.
4. Axe on the Account page sections, light and dark; 360 px.

---

## 11. Definition of done

- [ ] ADR 0023 written before building: the device model and side table, the export format and ZIP library, deletion with grace period and a ledger, what stays out
- [ ] The Devices section works (name, sign out, remove, others), and sensitive actions need a fresh session
- [ ] Security activity is recorded and shown without private data
- [ ] A person can export their workspace; it contains only their data; downloads expire
- [ ] Deleting an account removes every row and every stored file, tested table by table, after a cancellable grace period
- [ ] Notification-device switches work once V2 feature 14 exists (until then the section is hidden)
- [ ] No tokens, ids or raw user-agents shown; no content in emails or the ledger
- [ ] Axe passes; 360 px
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/account-and-device-center_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 12. Out of scope (this feature)

- Per-person AI provider keys or model choice; billing and plans.
- Two-factor authentication, passkeys, new-device alert emails, sign-in blocking or risk scoring (candidates for feature 13's security work).
- Restoring a deleted account; ownership transfer before deletion.
- Importing data from the export or from other apps.
- Organisation-level admin (users, roles, audit across people).
- IP geolocation.
