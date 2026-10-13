# Feature 08 — Automation Engine (V3)

> **Build position: eighth V3 feature** (V3 plan phase 6). Depends on feature 07 (events), and through it on the worker (V2 feature 08). It also introduces the **approvals** that the agent runtime (09) reuses. Behaviour is in V3 product spec §10 (Automation). Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- A person defines **WHEN / IF / THEN** workflows: one trigger, up to five conditions, up to five actions.
- A **very small first set** of triggers and actions (`../Agent.md` §7: do not build dozens).
- A **human-readable preview and a test (dry run)** before an automation can be turned on.
- **Runs** with step results, retries, a run history and failure messages that say what to do.
- **Approvals:** any action can be set to *Ask me first*; the run pauses until the person decides. This table is shared with the agent runtime.
- Safety: idempotent actions, loop protection, rate caps, auto-disable.

Reuses: feature 07 (events, deliveries, correlation ids, loop guard), V2 feature 08 (jobs, scheduler), feature 03 (notes from a template, with placeholders), feature 06's notification table (for "notify me"), the task and note mutation layers, `audit_log` (widened with `AUTOMATION`).

Packages: none.

Source spec sections: V3 product §10, technical spec §6 and §8, UI/UX spec §7, §8 and §10, `../Agent.md` §7, project plan phase 6.

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Model, trigger matching on events, the first conditions and actions, runs and steps, idempotent effects, worker job | A hand-made automation runs on task completion |
| **B** | Builder UI, preview and test, enable/disable, run history | A person can build and trust one |
| **C** | Approvals, schedule and manual triggers, rate caps and auto-disable, mobile | Useful for the weekly rhythm |

---

## 2. What it can do (first release)

**Triggers** (one per automation)

| Trigger | Fires when |
|---|---|
| Task completed | `task.completed` for the person's own task |
| Task created | `task.created` |
| Note created | `note.created` (not journal entries) |
| On a schedule | daily or weekly at a local time (uses the scheduler) |
| Run manually | the person presses **Run** on the automation, or runs it from the command menu (feature 11); the current item, if any, is the subject |

**Conditions** (all must hold, up to 5)

Project is / is not *X*; has tag *X*; priority is *X*; title contains *text* (case-insensitive, plain text, ≤ 80 chars); due date is within *N* days. A schedule or manual trigger has no subject item, so only project-independent conditions apply to it.

**Actions** (run in order, up to 5)

| Action | Does | Risk class |
|---|---|---|
| Create a note | From a template (feature 03) or empty; title and project can use placeholders `{{task.title}}`, `{{task.project}}`, `{{date}}`, `{{day}}` (the same plain-text replacement as templates); optionally linked to the subject task | local reversible |
| Create a task | Title (placeholders), project, due *N* days after, priority | local reversible |
| Add a tag | To the subject task or note | local reversible |
| Move to a project | The subject task or note | local reversible |
| Set the due date | On the subject task: in *N* days, or next Monday | local reversible |
| Notify me | An in-app notification (feature 06) with a short fixed-form message | local reversible |

**No destructive actions** (delete, archive in bulk) and **no external side effects** (email, webhooks, HTTP calls) in this release. Both are possible later through the same risk classes.

Everything runs **as the owner** and only on the owner's own data. If an editor completes a task in a project the owner shared (feature 04), the owner's automations for that project do run (the event belongs to the owner's workspace); a collaborator's own automations never act on the owner's items.

---

## 3. Data model

### `automations` (new)

`id`, `user_id` (cascade), `name` (≤ 120), `enabled` bool (default false), `version` int, `trigger` jsonb (`{ type, config }`), `conditions` jsonb[], `actions` jsonb[] (each with `type`, `config`, `requireApproval`), `created_at`, `updated_at`, `deleted_at`, `last_run_at`, `disabled_reason` (`USER`, `RATE_CAP`, `REPEATED_FAILURE`, `INVALID`). All JSON is validated by Zod schemas from one registry (`src/modules/automations/registry.ts`), never free-form. At most **20** live automations per person.

### `automation_runs` (new)

`id`, `automation_id` (cascade), `automation_version`, `user_id`, `event_id` NULL (manual and schedule runs have none), `correlation_id`, `status` (`QUEUED`, `RUNNING`, `WAITING_APPROVAL`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELLED`), `skip_reason` (e.g. `CONDITIONS_NOT_MET`, `ITEM_GONE`), `retry_count`, `started_at`, `ended_at`, `summary` (≤ 200 chars, counts and kinds only), `schedule_window` NULL. Unique `(automation_id, event_id)` and unique `(automation_id, schedule_window)`: **one run per event and per schedule window**, even with several workers.

### `automation_run_steps` (new)

`run_id` (cascade), `idx`, `kind` (`CONDITION`, `ACTION`), `type`, `status` (`PENDING`, `OK`, `SKIPPED`, `FAILED`, `WAITING_APPROVAL`), `result` jsonb (ids and counts only), `error_code`, `started_at`, `ended_at`. Primary key `(run_id, idx)`.

### `automation_effects` (new, the idempotency record)

`key` text unique (`{runId}:{stepIdx}:{n}`), `entity_type`, `entity_id`, `created_at`. An action that creates something inserts the effect **in the same transaction** as the thing it creates and checks the key first. A retry of a half-finished step therefore finds the effect and does not create it again.

### `approval_requests` (new, shared with feature 09)

`id`, `user_id`, `requester_type` (`AUTOMATION`, `AGENT`), `requester_id` (run id), `step_ref`, `risk_class` (`LOCAL_REVERSIBLE`, `LOCAL_DESTRUCTIVE`), `summary` (≤ 200 chars), `items` jsonb (what would change, as ids, kinds and short labels), `input_hash` (a hash of the exact validated action input), `status` (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`), `decided_at`, `expires_at` (default 7 days), `created_at`. Index `(user_id, status, created_at DESC)`.

Migration: expand-only (new tables); `audit_log.source` check widens to include `'AUTOMATION'`.

---

## 4. Running an automation

1. **Match.** The consumer `automation.match` (feature 07) subscribes to the trigger events. For each event it loads the owner's enabled automations for that type, **ignoring automations whose id equals the event's `source`** (an automation never reacts to itself) and enforcing the global `depth` limit.
2. **Create the run** (`ON CONFLICT DO NOTHING` on `(automation_id, event_id)`), queue the job `automation.run`.
3. **Evaluate conditions** against fresh data loaded by id with the owner's access. Not met → run `SKIPPED` with the reason. The item deleted meanwhile → `SKIPPED` (`ITEM_GONE`).
4. **Execute actions** in order. Each step: write the step row, check `automation_effects` for each planned effect, perform, record. An action with `requireApproval`, or any action whose risk class is above what the person allows, creates an `approval_requests` row (with `input_hash`), sets the step and run to `WAITING_APPROVAL` and stops. Approving queues the job again; **the executor refuses to run a step whose approval is not `APPROVED` for the same `input_hash`**, so changing the input after approval needs a new approval.
5. **Finish:** `SUCCEEDED`, or `FAILED` with the failing step. A retryable failure (database busy, worker restart) retries the run from the first unfinished step, up to 3 times with back-off. A permanent failure (the project was deleted) fails the step with a clear code. A run never rolls back steps already done; effects are individually reversible by the person (the created note can be trashed).
6. **Emit** `automation.triggered` at the start and let created items emit their own events with `source = AUTOMATION:{id}`, `causation_id`, `depth + 1`.

**Schedule and manual triggers:** the job `automation.schedule_scan` (every minute, scheduler) fires due schedule automations by inserting a run with `schedule_window` (the local date-time window), once per window across workers. A manual run inserts a run with a fresh key. Missed windows (worker down) are **not** replayed more than 1 hour late: they are marked `SKIPPED` (`MISSED_WINDOW`).

---

## 5. Safety limits

- **Rate caps** per automation: 60 runs per hour, 500 per day. Exceeding disables it (`disabled_reason = RATE_CAP`) and notifies the owner.
- **Repeated failure:** five consecutive failed runs disable it (`REPEATED_FAILURE`) with a notification.
- **Loop guard:** `depth > 3` events are dropped (feature 07); an automation ignores events it caused.
- **Authorization:** actions call the same mutation functions as the UI with the owner's id; project, tag and template ids are re-checked at run time, not only when the automation was saved.
- **No generated string becomes a side effect except through a validated action config** (`../Agent.md` §8). Placeholder values are plain text, length-capped, with control characters removed.
- **Privacy:** run results and logs hold ids, counts and kinds, never titles or text.
- **Editing an enabled automation turns it off** until its new preview is accepted (a new `version`).

---

## 6. Server contract

Actions in `src/actions/automations.ts` (each `requireUser()`, Zod input, `runAction`):

`createAutomation`, `updateAutomation` (disables it), `duplicateAutomation`, `deleteAutomation` / `restoreAutomation`, `previewAutomation({ id | draft })` (returns the sentence and the planned steps, creates nothing), `testAutomation({ id | draft, subject? })` (dry run on a chosen recent item or a sample: evaluates conditions and returns what each action **would** do), `setAutomationEnabled({ id, enabled })` (requires the stored `previewed_version` to equal `version`), `runAutomationNow({ id, subject? })`, `retryRun({ runId })`, `cancelRun({ runId })`, `decideApproval({ id, decision })`, and queries `listAutomations`, `getAutomation`, `listRuns({ automationId?, status?, cursor })`, `getRun`, `listApprovals({ status })`.

Each action definition in the registry implements `describe(config): string`, `plan(ctx, config): Planned`, `execute(ctx, config, idempotencyKey)` and a Zod config schema. `describe` produces the preview sentence; `plan` is the dry run. A test checks that every registered action has all of them.

Preview sentence example: *When a task is completed, if its project is "OZZI", create a note from the "Review" template in "OZZI" titled "Review: {task title}".*

---

## 7. UI

### Navigation

A new sidebar group **Automate** holds **Automations** (`/automations`, Lucide `Workflow`); on a phone it sits under More. Command menu entries are in feature 11. (Memory and devices live in Settings, features 10 and 12.)

### `/automations`

Tabs **Automations**, **Activity** and **Approvals** (with a count).

- **Automations:** a hairline list: name, the preview sentence (one line), an on/off switch (text "On"/"Off" too), last run and its result. **New automation**. Empty state with one worked example the person can add disabled ("When I complete a task in a project, create a review note").
- **Activity:** all runs, newest first: automation, status (text and icon), triggered time, duration, retries, one-line summary. Filter by status. Failed rows say what happened and what to do ("The project 'OZZI' no longer exists. Edit the automation to choose another.") with **Retry** where safe.
- **Approvals:** pending items from automations and agents (feature 09), each as the card in UI/UX spec §10: what it wants to do, **Review** (opens detail with the exact items), **Approve**, **Reject**.

### The builder (`/automations/[id]`)

A vertical WHEN / IF / THEN layout (UI/UX spec §7), each block a form row (selects and fields, no free canvas). **Add condition** and **Add action** are explicit buttons. Each action has **Ask me first** (a checkbox). A fixed bottom area shows the **preview sentence**, a **Test** button (choose a recent item, see per-step results, nothing is written) and **Turn on** (enabled only after the current version has been previewed). The run history for this automation sits beneath. Mobile: the same single-column form; editing is simplified (no reordering by drag, up/down buttons) but every part stays inspectable.

### Accessibility

Forms use real labels and fieldsets; status is text with an icon; the preview sentence is a live region that updates politely on change; approval cards are focus-managed; no motion beyond the app's standard.

---

## 8. Tests

**Unit**: Zod schemas for every trigger, condition and action (valid, invalid, caps); `describe` for each combination (snapshot); placeholder replacement; condition evaluation matrix; schedule window computation across time zones and daylight saving; rate-cap arithmetic; every registered action implements `describe`, `plan` and `execute` and declares a risk class.

**Integration** (real database, worker loop in-process)
- **Idempotency:** the same event delivered twice yields one run and one created note; a crash after the effect but before the step is marked complete retries without a second note (effects table); a retry of a failed later step does not repeat earlier steps.
- Conditions: each type matches and fails correctly; an item deleted before the run skips it.
- **Authorization:** an automation referencing another person's project or template fails at save and at run; an editor's completion in a shared project triggers the owner's automation but never a collaborator's automation on the owner's items.
- **Loops:** an automation creating a task that triggers another that creates a task stops at depth 3; an automation does not react to its own events.
- **Approvals:** a step with *Ask me first* pauses; approve runs it exactly once; reject cancels the rest; expiry marks it `EXPIRED`; **changing the action input after approval requires a new approval** (`input_hash`); a step cannot be executed with another person's or a missing approval.
- Schedule: two workers fire one run per window; a missed window beyond an hour is skipped; manual runs work.
- Rate cap and repeated failure disable the automation and notify.
- Editing an enabled automation disables it; `setAutomationEnabled` without a current preview is refused.
- Run results contain no titles or text.

**E2E**
1. Build "when a task in OZZI is completed, create a note from a template", test it, turn it on, complete a task: the note appears once; the run shows in Activity with its steps.
2. Complete a task in another project: the run is skipped with the reason.
3. An *Ask me first* action creates an approval; approve it from the Approvals tab: the note appears.
4. Break the automation (delete the project): the next run fails with an actionable message; Retry after fixing it works.
5. Disable it: nothing runs.
6. Axe on the list, builder, Activity and approval card, light and dark; the builder at 360 px.

---

## 9. Definition of done

- [ ] ADR 0021 written before building: the workflow model, the fixed registry of triggers and actions, idempotent effects, approvals, loop and rate protection
- [ ] A person can build, preview, test, turn on, edit, disable and delete an automation; editing turns it off until re-previewed
- [ ] Each event or window produces at most one run, and each effect happens once, also under retries and with several workers
- [ ] Approvals pause and resume runs, and a step cannot run without a matching approval
- [ ] Loops and runaway automations are stopped and the owner is told
- [ ] Runs show status, time, duration, steps, failures, retries and approval waits, and failures say what to do
- [ ] Only the owner's own data can be touched; nothing destructive or external exists in this release
- [ ] Axe passes; the builder works at 360 px
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/automation-engine_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 10. Out of scope (this feature)

- Destructive actions, bulk changes, email, webhooks and any call to an outside service.
- A custom language, formulas, loops, branching, "else", or multiple triggers per automation.
- Triggers from calendar events, comments, shares or file uploads (the catalogue can grow later).
- AI-written automations ("describe it and I'll build it") and AI steps inside a workflow (feature 09 is the AI route).
- Sharing automations; a gallery of templates.
- Automations that act across several people's data.
