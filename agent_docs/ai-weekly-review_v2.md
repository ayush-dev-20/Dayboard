# Feature: AI weekly review

**Phase:** V2 (feature 15)
**Status:** In progress. Built and tested against the mock provider, plus one real Gemini call with a sample week. The "ready" notification is queued from `generateReview` (feature 14, `push-notifications-and-reminders_v2.md`). Not built: the offline copy of reviews.
**Date:** 2026-10-15

## What was built

- **The review** at `/review` (sidebar item "Weekly review" under Plan, and in More on phones). Three parts, in this order: **What happened** (facts, plain headings and lists, every item a link), **Suggested focus** (the labelled AI panel: summary, up to three focus areas each with "Based on" buttons that scroll to and mark the supporting facts, watch-outs), and **Carry-forward** (an editable proposal). A week switcher lists the weeks that have a review plus the current one; the week is in the address (`?week=2026-10-12`).
- **Facts** (`src/lib/review/facts.ts`, pure; `load.ts` reads one person's rows): completed tasks and todos with per-project counts and the ten most recent, open tasks due on or before the week's end (count, carried-forward count, the ten oldest with days late), notes created and edited, projects with activity and projects quiet for three weeks (not new ones), calendar load (only when a calendar is connected and selected), tasks moved later twice or more in four weeks, inbox captured and processed. Stored as versioned JSON with titles and ids, never a note body.
- **Suggestions** (`suggestions.ts`): one AI action (`WEEKLY_REVIEW`, prompt `WEEKLY_REVIEW_V1`). The answer is checked against the facts: ids must be ones the review holds, a new date must be today or later, text is capped, the rest is dropped; nothing left means facts-only. AI off, over the limit or failing never fails the review: it is facts-only with a one-line reason and **Add suggestions**. Regenerating is once a day.
- **Making a review** (`service.ts`, `handlers.ts`): an hourly `review.scan` queues one `review.generate` per person at their review day and hour (default: last day of their week, 17:00 local); the job makes the final review (`partial = false`), replaces a "week so far", and does nothing if a final one exists. **Generate now** makes a "week so far" (`partial = true`) for the current week and never replaces a final one. A week with nothing done and nothing written gets no review.
- **Apply** (server action `applyCarry`): exactly the ticked rows, through `updateTask` (reason `REVIEW`), `archiveTask` and `setTaskStatus`; one `audit_log` row (source `WEEKLY_REVIEW`, counts only); once per set of suggestions; the toast and an inline button offer Undo, which restores each task as it was. Nothing changes before Apply. A suggested DROP starts unticked and is an Archive unless the person picks Cancel.
- **Schedule history** (`task_schedule_history`, `feature_epochs`): `updateTask` records a row whenever a due date really changes (online and replayed offline changes both go through it). "Not enough history yet" until two weeks have been recorded. Pruned after a year (`review.prune_history`, daily).
- **Today card** "Your weekly review is ready" for a finished, unread review, with Open and Not now; never offered again once opened or dismissed. **Settings → Productivity → Weekly review**: switch, day, hour.

## Why

The product rule is that facts are observed and suggestions are advice, and a model must never touch a number. So facts are plain code over the person's own data, and the model's answer is only ever validated against them. ADR 0026 has the reasoning and the alternatives.

## What was deferred

- **The "ready" notification** is now sent by feature 14: the end of `generateReview` calls `enqueueNotification` for a final (`AUTO`) review, keyed by the review id, and delivery applies the person's category switch and quiet hours. A "week so far" never notifies.
- **Offline reading** (the last twelve reviews cached, "shows the cached review offline"): feature 04 owns the local database and the offline shell has no review screen. Generating needs a connection and says so.
- **Reasons `PLAN_DAY`, `OVERDUE_CLEANUP`, `BOARD_DRAG`, `CALENDAR_DRAG`** in the schedule history: those callers are client components that pass no reason, so their moves are recorded as `MANUAL`. Only `MANUAL` and `REVIEW` are written.
- **`setWeeklyReviewPreferences`**: the settings use the existing `updatePreferences` action with three new fields.
- **The calendar-load fact** is covered by unit tests and the mock calendar in the loader path, but has no E2E (no connected calendar in the review spec).
- **A full E2E run**: the new spec and the specs for the places this touches pass; a complete run was not repeated after this feature.

## Deviations from the spec

In ADR 0026: three extra columns (`suggestions_error`, `suggestions_at`, `carry_applied_at`) and a `feature_epochs` table; the hourly scan instead of a per-person schedule row; a worker run just after a week ended still makes that week's review; `GET /api/review/latest|{weekStart}` return `NOT_FOUND` for a malformed date.

## Related files

- `src/db/schema/review.ts`, migration `0017_weekly-review.sql` (tables, `WEEKLY_REVIEW` enum value, three `user_preferences` columns, the epoch row, the `review.scan` and `review.prune_history` schedules).
- `src/lib/review/`: `types.ts` (client-safe), `week.ts`, `facts.ts`, `load.ts`, `suggestions.ts`, `history.ts`, `service.ts`, `handlers.ts`, `format.ts`, `client.ts`. `src/lib/ai/providers/mock-review.ts`, `schemas.ts` (`reviewSuggestionsOutputSchema`), `prompts.ts`.
- `src/db/mutations/tasks.ts` (`updateTask` writes the history; takes `{ reason }`), `src/app/api/review/**`, `src/actions/review.ts`, `src/lib/validations/review.ts`.
- `src/components/review/` (`weekly-review.tsx`, `facts-view.tsx`, `suggestions-panel.tsx`, `carry-forward.tsx`, `review-ready-card.tsx`, `based-on.ts`), `src/app/(app)/review/page.tsx`, `settings/weekly-review-settings.tsx`.
- Shared files touched (small edits): `nav-items.ts`, `more/page.tsx`, `today/page.tsx`, `settings/productivity/page.tsx`, `proxy.ts`, `robots.ts`, `jobs/builtin.ts`, `ai/*`, `validations/settings.ts`, `schema/preferences.ts`.
- Tests: `tests/unit/review-pure.test.ts` (26), `review-format.test.ts` (4); `tests/integration/review.test.ts` (27); `e2e/review.spec.ts` (17).

## Hand-off notes

- **Migration `0017`** is applied to the **test** database only. Dev and Neon still need it (ask before Neon).
- **Tests:** the mock builds its suggestions from the facts it is given (reschedule the oldest late task to tomorrow, keep the second, drop the third) and adds a made-up task id on purpose, which validation drops. `[mock:error]` in a task title makes the suggestions fail (the title is in the facts the model is shown). Integration tests pass a fixed `now` (Sunday 2026-10-18) to `generateReview`; the scheduled-job tests use the real clock for their current-week check. The scan reads everyone in the shared test database, so those tests first switch the review off for everyone else.
- **Gemini and schemas:** the output schema has no `.max()` on any list on purpose (see ADR 0012); the server trims.
- **Never put a `Date` in a `sql` template** (the driver refuses it); use `gte`/`lt`. The loader follows this.
- **The page answers in place** after Generate now: it does not call `router.refresh()`, because a refresh can bring back an older copy over a newer one.
- **Postponement E2E tests** move a global value (`feature_epochs`) and so run serially and restore it.
- Related: `background-worker-and-jobs_v2.md` (jobs and schedules), `ai-workspace-assistant_v2.md` (the apply and audit pattern), `google-calendar_v2.md` (busy windows), `voice-capture_v2.md`, `ai-writing-and-planning_v1.md` (the AI pipeline).
