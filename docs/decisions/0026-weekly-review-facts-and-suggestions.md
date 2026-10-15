# 0026. Weekly review: facts computed in code, suggestions checked against them

**Status:** Accepted
**Date:** 2026-10-15
**Phase:** V2

## Context

V2 feature 15 (`specs/v2/features/15-ai-weekly-review.md`) adds a weekly review that must keep **observed facts** apart from **AI suggestions**. Facts have to match the person's own data exactly; a model must never state or change a number. It also needs "repeated postponements", which V1 never recorded, and an automatic run at the end of each person's week. The spec asks for no ADR, but it makes choices the code depends on and departs from it in a few places.

What the project already had: feature 08's jobs (a worker, tick mode, global schedules with a fixed cadence), feature 11's apply-a-proposal and audit pattern, feature 12's calendar events, the V1 AI pipeline (gate, limits, mock), and one task update path (`updateTask`) that every due-date change goes through, including offline changes replayed by the sync push.

## Decision

- **Facts are pure code.** `src/lib/review/facts.ts` assembles them from rows the loader (`load.ts`) read for one person and one week; the result is stored as versioned JSON (`weekly_reviews.facts`) with titles and ids and never a note body. Suggestions live in their own column and are only ever **validated** against the facts (`suggestions.ts`): every id must be one the review holds, a date must be today or later, text is capped, and what fails is dropped. If nothing is left, the review is facts-only. The model is shown the facts and cannot change them.
- **A week is the person's own.** Their week-start preference picks the first day, the time zone and their start-of-day set when each day begins, and the window is measured in instants, so a DST week is 167 or 169 hours long and a late-night task belongs to the day before.
- **One AI action per review**, recorded as the new `ai_feature` value `WEEKLY_REVIEW`, checked against the V1 limits first. AI off, over the limit or failing gives a facts-only review with a plain reason code (`suggestions_error`), never a failed review, and "Add suggestions" retries. Regenerating is once a day, on the person's own day (`suggestions_at`).
- **Scheduling uses an hourly scan.** The scheduler only has global cadences, so a seeded `review.scan` runs every hour and queues one `review.generate` per person whose review day and hour have come, once, with a dedupe key per person and week. The hour is read on the person's own day and stays true until it ends, so a late tick still finds them. A job that runs just after the week ended still makes that week's review (the previous week is allowed for the worker, never for a person). A person with nothing done and nothing written gets no review.
- **Schedule history is written by the one update path.** `updateTask` records a row whenever `due_date` really changes, inside its transaction, with a reason (`MANUAL` by default, `REVIEW` for the review's own reschedules). A small `feature_epochs` table holds when recording began, so "not enough history yet" (under two weeks) can be told from "nothing was postponed". There is no backfill; rows older than a year are pruned daily.
- **Applying the carry-forward list is a server action** that calls the same mutations as everything else (`updateTask`, `archiveTask`, `setTaskStatus`), claims the proposal once (`carry_applied_at`), writes one `audit_log` row (source `WEEKLY_REVIEW`, counts only) and returns what each task was before, so Undo can put it back. A suggested DROP starts unticked and is an Archive unless the person picks Cancel.
- **Three columns beyond the spec** (`suggestions_error`, `suggestions_at`, `carry_applied_at`) and one small table (`feature_epochs`), because "the reason in one line", "once a day" and "applied once" need somewhere to live.

## Alternatives

- **Let the model write the facts too.** Fewer lines of code, but a number could be wrong and nothing could prove otherwise. Rejected: it is the product rule of the feature.
- **A per-person schedule row.** Would use the scheduler as it is, but needs a row created and moved whenever a preference changes. Rejected for a scan that reads the preferences it already owns.
- **Infer "enough history" from the oldest row for the person.** Wrong for someone who never moved a date, who would be told "not enough history" for ever. Rejected for the epoch.
- **Write the history in the actions.** Would miss the offline path (the sync push calls the mutation). Rejected.

## Consequences

- **Checked against the real API (2026-10-15)** with a sample week: Gemini accepted the output schema, used only ids and numbers from the facts, and returned dates that validated. The schema has no `.max()` on any list, because a list limit around items that hold lists made Gemini refuse the schema while building voice capture (ADR 0012).
- **Reasons other than `MANUAL` and `REVIEW` are reserved.** The enum lists `PLAN_DAY`, `OVERDUE_CLEANUP`, `BOARD_DRAG` and `CALENDAR_DRAG`, but those callers are client components that do not pass a reason yet, so their moves are recorded as `MANUAL`.
- **Not built:** the "ready" notification (feature 14 does not exist; the Today card is the only signal, and the seam is the end of `generateReview`), the offline copy of the last twelve reviews (feature 04 owns the local database and the offline shell has no review screen), and the calendar-load fact has only been tested against the mock calendar.
- A review is private data like a note: deleted with the account (foreign key cascade), never logged, and counts only in `audit_log` and `ai_usage`.
- The hourly scan reads every person with the review on. At large scale it should become an indexed query on the review day; today it is one small table scan an hour.
