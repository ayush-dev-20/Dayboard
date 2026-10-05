# Feature 15 — AI Weekly Review

## 1. Scope

- A **weekly review** the person can read in a few minutes: what happened (computed facts) and what to focus on next (AI suggestions), kept visibly separate
- Facts: completed tasks, overdue and carry-forward items, notes created, projects with activity, calendar load, repeated postponements
- Suggestions: focus areas, what to do with carry-forward items (proposals the person confirms), a short reflection
- **Automatic generation** at the end of the week by the worker, plus **Generate now**
- A review **history**, a "ready" notification, and a facts-only fallback when AI is unavailable
- A new, small **schedule history** log so "repeated postponements" can be observed honestly

Reuses: feature 08 jobs and scheduler, feature 11's proposal and audit patterns, feature 12 calendar events (optional input), feature 14 notification enqueue, V1 AI pipeline (gate, limits, prompts, mock), V1 overdue-cleanup confirm pattern, `src/lib/dates/*` (week start, time zones), V1 Today brief and Plan my day (they stay).

Source spec sections: product §11, §13, §2.1 row 9; technical §6, §12, §13; project plan Phase 6 item 6.

The product rule: the review **distinguishes observed facts from AI suggestions**. Facts come from the database and are never produced or altered by a model.

---

## 2. Data model

### `weekly_reviews`

| Column | Notes |
|---|---|
| `id`, `user_id` | user cascade |
| `week_start`, `week_end` | `date` in the person's calendar (their `week_start` preference decides the first day); unique `(user_id, week_start)` |
| `status` | `PENDING, READY, FAILED` |
| `facts` | jsonb: the deterministic facts (§4), versioned with `facts_version` |
| `suggestions` | jsonb NULL: validated AI output (§5); null when AI was unavailable |
| `suggestions_status` | `NONE, GENERATED, UNAVAILABLE, OFF` |
| `partial` | boolean: true for a "week so far" review generated before the week ended |
| `model`, `prompt_version` | for provenance |
| `generated_at`, `viewed_at`, `dismissed_at` | |
| `created_at`, `updated_at` | |

Reviews contain titles and counts from the person's own data, so they are private user data (same sensitivity as notes), deleted with the account, never logged.

### `task_schedule_history` (new, needed for postponements)

V1 does not record when a due date moves. This log starts accumulating when the feature ships (no backfill).

| Column | Notes |
|---|---|
| `id`, `user_id`, `task_id` (cascade) | |
| `from_date`, `to_date` | date NULL both ways |
| `reason` | `MANUAL, PLAN_DAY, OVERDUE_CLEANUP, BOARD_DRAG, CALENDAR_DRAG, REVIEW` |
| `changed_at` | timestamptz |

Written by the single task-update path whenever `due_date` changes (online mutation functions and operation apply from 05, so offline edits are included). Retained 12 months. A **postponement** is a change where `to_date` is later than `from_date` (and `from_date` was not null).

### Preferences

`user_preferences`: `weekly_review_enabled` (default true when AI is available), `weekly_review_day` (default: the last day of the person's week), `weekly_review_hour` (default 17, local). The notification category is `WEEKLY_REVIEW_READY` (14).

### Local (Dexie)

The latest review and the last 12 are cached for offline reading.

---

## 3. When a review is made

- **Automatic:** a per-user scheduled job `review.generate` runs at the person's configured day and hour (default: the last day of their week, 17:00 local). It creates the review for the **current week** (so it is a review of the week that is ending; `partial = false` once the week day has come). If the person was inactive all week (no tasks done, no notes), no review is created and nothing is sent.
- **Generate now:** the Review page can generate a **week so far** review any time (`partial = true`), replacing the previous partial one for that week. A final automatic review overwrites a partial one for the same week. Regeneration of suggestions is limited to **once per day** per week.
- **Idempotent:** the unique `(user_id, week_start)` plus a dedupe key per week make double runs harmless. The job runs on the worker (08); in tick mode it may be late by the tick interval.
- If AI is off or failing, the review is still created with **facts only** (`suggestions_status = UNAVAILABLE/OFF`) and a later "Add suggestions" action retries when AI works.
- After a final review is `READY`, the worker enqueues the `WEEKLY_REVIEW_READY` notification (14).

---

## 4. Facts (deterministic, no AI)

`src/lib/review/facts.ts` (pure, over data loaded owner-scoped for the week window in the person's time zone, honoring start-of-day):

| Fact | Definition |
|---|---|
| **Completed** | tasks and todos completed in the week: count, per project counts, the first 10 titles (most recently completed) with links |
| **Overdue and carry-forward** | open tasks whose due date is on or before week end and not completed: count, the 10 oldest with days late and links; those that were due this week and remain open are "carried forward" |
| **Notes** | notes created in the week (count, titles up to 8) and notes edited (count) |
| **Projects with activity** | projects where any task was completed, note created or task created in the week, with counts; projects with nothing for 3 or more weeks flagged "quiet" |
| **Calendar load** | when a calendar is connected (12): meeting hours per day and the busiest day, from synced events (busy only); omitted entirely when not connected, never estimated |
| **Postponements** | tasks whose due date was moved later two or more times in the last 4 weeks (from `task_schedule_history`), with counts; if less than 2 weeks of history exist the fact says "Not enough history yet" |
| **Inbox** | items captured vs processed in the week |

Facts are stored as a typed JSON document (`facts_version` for evolution), include stable ids for every item referenced, and never contain note bodies. A fact is only shown if it can be computed; sections with no data say so plainly.

---

## 5. AI suggestions

- **Input:** the facts JSON plus a bounded set of titles and ids (the same items already in the facts), and the person's planning context (working hours, optionally busy hours). No note bodies or event titles unless the person opted in for planning (12).
- **Output schema** (Zod, validated, one repair retry as V1):

```ts
type ReviewSuggestions = {
  summary: string;                                   // ≤ 400 chars, plain, no flattery
  focusAreas: { title: string; why: string; basedOn: FactRef[]; taskIds?: string[] }[];   // ≤ 3
  carryForward: { taskId: string; action: "KEEP" | "RESCHEDULE" | "DROP"; newDueDate?: string; reason: string }[];  // ≤ 8
  watchouts: string[];                               // ≤ 3, e.g. repeated postponements
};
```

- `FactRef` points at a fact key and ids, so every suggestion can show **what it is based on**.
- **Server validation:** every `taskId` must be among the review's own carry-forward or relevant tasks and owned by the user; `newDueDate` must be today or later in the person's day (relative phrases resolved with `dates/resolve`); anything invalid is dropped, and if nothing remains the suggestions are treated as unavailable. Text is length-capped.
- **Model:** the default model; one AI action against the V1 limits; failure leaves facts-only.
- **Prompt rules** (`WEEKLY_REVIEW_V1`): use only the provided facts; never state a number the facts do not contain; keep observations and advice separate; no moralising; offer fewer items rather than more; reply in the person's language.

### Applying carry-forward proposals

The carry-forward list is a **proposal** (V1 overdue-cleanup pattern): rows editable (action and date), ticked by default for KEEP and RESCHEDULE and unticked for DROP, **Apply N** performs them through the existing commands (reschedule = `task.update { dueDate }` with reason `REVIEW` in the schedule history; DROP = archive or cancel as the person picks), with Undo, and one `audit_log` row (source `WEEKLY_REVIEW`, counts only). Nothing changes until Apply.

---

## 6. UI

- **Review page** `/review` (nav item under Plan, "Weekly review"): the current or latest review, with a week switcher (last 12). Sections, in this order:
  1. **What happened** (facts): short numeric lines with links ("12 tasks completed", "5 overdue, oldest 9 days"), expandable lists of items, per-project activity, calendar load (if connected), postponements. Plain headings, no AI styling.
  2. **Suggested focus** (AI): in the tinted AI panel with the "AI-generated" label: the summary, focus areas each with **Based on** chips that scroll to and highlight the supporting facts, watch-outs.
  3. **Carry-forward** (proposal): the editable list with **Apply N**.
  The facts and the AI parts are visually and verbally separate (heading "What happened" versus the labelled AI panel) so a suggestion can never be mistaken for an observation.
- **Today:** when a review is ready and unread, a quiet card "Your weekly review is ready" with **Open** and **Not now**; never repeated after dismissal.
- **Generate now** button (week so far), **Regenerate suggestions** (once a day) and **Add suggestions** (when they were unavailable).
- **States:** no data yet ("Nothing to review yet this week"), facts-only (with a one-line reason: AI is off, unavailable, or over today's limit), generating (skeleton), failed (Retry), offline (shows the cached review; generation needs a connection), AI off (facts only, no AI panel).
- **Settings → AI (or Productivity):** weekly review switch, day and hour, and a link to the notification category.
- **Accessibility:** headings structure, facts as lists, "Based on" chips are buttons with names, 44px targets, reduced motion for highlight, light and dark.

---

## 7. Server contract

| Route / action | Purpose |
|---|---|
| `GET /api/review/latest`, `GET /api/review/{weekStart}`, `GET /api/review` | owner-only reads (history list: 12 most recent) |
| `POST /api/review/generate` | `{ weekStart?, partial? }` → creates or refreshes facts and, if AI is available, suggestions (streamed or one JSON; V1 gate: AI enabled, limits) |
| `POST /api/review/{weekStart}/suggestions` | (re)generate suggestions once per day |
| `markReviewViewed`, `dismissReviewCard` | Server Actions |
| `setWeeklyReviewPreferences` | Server Action |
| Worker `review.generate` | scheduled per user (08); re-derives the user from the job row |

Applying proposals uses existing commands, not a review-specific write endpoint. Errors: `AI_DISABLED`, `RATE_LIMITED`, `VALIDATION_ERROR`, `NOT_FOUND`.

---

## 8. Rules and safety

- **Facts are never AI-generated or AI-edited.** The model's text cannot change a fact's number or list; the UI renders facts from the stored JSON only.
- Suggestions never mutate data; apply is an explicit, audited, undoable action.
- All queries are owner-scoped; the job re-checks ownership from its row.
- No titles, bodies or review text in logs, `ai_usage` or audit rows (counts only).
- The review never shames: neutral wording; "not enough history" instead of guessing; a quiet week is a valid week.
- Week boundaries use the person's time zone and week-start preference, including DST weeks.

---

## 9. Tests

**Unit**
- Week boundaries for each `week_start`, time zones and DST weeks, start-of-day rollover; partial vs final.
- Fact computation from fixtures: completed counts and ordering, overdue and carry-forward classification, notes created vs edited, project activity and "quiet", inbox counts, calendar load from sample events, postponement counting from `task_schedule_history` (including "not enough history").
- Suggestion validation: unknown or foreign ids dropped, past dates rejected, caps, `FactRef` resolution, empty-after-validation becomes unavailable.
- Schedule history writer: only on `due_date` change; direction (postponement vs earlier).

**Integration** (mock provider)
- Generation is idempotent per week; a final run replaces a partial; suggestions regeneration limited to once per day.
- Facts are scoped to the owner (another person's tasks never counted); facts equal what the database says.
- AI failure and AI off still produce a facts-only review; "Add suggestions" later succeeds.
- Apply carry-forward: exactly the ticked rows change, schedule history records `REVIEW`, one audit row without content; Undo restores.
- Notification enqueue happens once on READY and not for facts-only partial reviews.
- Account deletion removes reviews.

**E2E** (mock provider; seeded tasks across a week)
1. Generate now: the page shows "What happened" with correct counts and the labelled AI section; "Based on" chips scroll to facts.
2. Carry-forward proposal: untick one, change a date, Apply → exactly those tasks change; Undo.
3. AI off → facts only; failure → Retry.
4. History switcher; Today card appears and is dismissable.
5. Postponement fact after moving a due date twice; "Not enough history" when none.
6. Offline shows the cached review.
7. Axe, 360px, light and dark.

---

## 10. Definition of done

- [ ] A weekly review is generated automatically (and on demand) with facts clearly separated from labelled AI suggestions
- [ ] Every fact is computed from the person's own data and matches it; suggestions reference the facts they are based on
- [ ] Carry-forward changes are proposals applied only on confirm, audited and undoable
- [ ] The review works without AI (facts only) and without a calendar
- [ ] Repeated postponements are observed from a real history log, with an honest "not enough history" state
- [ ] A "ready" notification and a Today card exist and are not repeated
- [ ] Private data stays out of logs and usage rows; reviews are deleted with the account
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/ai-weekly-review_v2.md` written and indexed

---

## 11. Out of scope (V2)

Monthly or quarterly reviews; sharing or exporting reviews; goals and OKRs; habit tracking; backfilling schedule history for past weeks; mood or journaling prompts; editing facts; comparing weeks side by side.
