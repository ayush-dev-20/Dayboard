# Feature 08 — Background Worker & Jobs

## 1. Scope

- A database-backed **job queue** and a separate **worker process** in the same image
- Claiming, **retries with backoff**, a dead-letter state, **visibility timeouts** and **heartbeats**
- A **scheduler** for recurring jobs, safe with more than one worker
- A **handler registry**, so later features add job types without touching the runner
- **Observability:** structured logs with correlation ids, queue and failure counts
- A **tick mode** so serverless hosts without a long-running process (such as Vercel) can still run jobs
- Compose service and dev command; the first real maintenance jobs

This is the foundation for embeddings (10), file cleanup (09), calendar sync (12), transcription (13), reminders and push (14) and weekly reviews (15). No user-facing UI beyond a small "Background work" panel in Settings → Sync.

Reuses: Drizzle and the migration runner pattern (`scripts/migrate.ts` bundled by esbuild into `dist/migrate.mjs`), the logger (`src/lib/logger.ts`), the env schema, request ids (`proxy.ts`).

Source spec sections: product §12 (background processing), §5; technical §12, §13, §14; project plan Phase 10; DevOps spec for Compose.

---

## 2. Data model

### `jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK (v7) | |
| `queue` | text NOT NULL default `default` | named queues so slow work cannot starve fast work (`default`, `ai`, `notifications`) |
| `type` | text NOT NULL | e.g. `embedding.index` |
| `payload` | jsonb NOT NULL | small: ids and parameters, never note text or transcripts |
| `payload_version` | integer NOT NULL default 1 | handlers must accept the previous version (rollback rule) |
| `user_id` | uuid NULL FK → user, cascade | set for per-user jobs; handlers re-check ownership from this, not from the payload |
| `status` | enum `QUEUED, RUNNING, SUCCEEDED, FAILED, DEAD, CANCELLED` | |
| `run_at` | timestamptz NOT NULL default now() | earliest start (delay and backoff) |
| `attempts` | integer NOT NULL default 0 | |
| `max_attempts` | integer NOT NULL default 5 | |
| `locked_by` | text NULL | worker id |
| `locked_until` | timestamptz NULL | visibility timeout |
| `dedupe_key` | text NULL | at most one non-final job per key (unique partial index where status in QUEUED, RUNNING) |
| `correlation_id` | text NULL | request id that enqueued it |
| `last_error` | text NULL | redacted, ≤ 500 chars, no content |
| `created_at`, `started_at`, `finished_at` | timestamptz | |

Indexes: `(queue, status, run_at)` for claiming, `(user_id, type, status)`, unique partial `(dedupe_key)`.

### `worker_heartbeats`

`worker_id` PK, `started_at`, `last_seen_at`, `version`, `queues text[]`, `current_job_id`, `hostname`. Rows older than 1 day are pruned.

### `job_schedules`

`name` PK (e.g. `reminders.scan`), `cron` text (limited form: `every 60s`, `daily 03:00 UTC`), `type`, `payload`, `queue`, `enabled`, `last_run_at`, `next_run_at`. Seeded by migration for the jobs below; features add rows in their own migrations.

---

## 3. Runner

Entry `src/worker/index.ts`, bundled to `dist/worker.mjs` by a `build:worker` script (esbuild, same banner trick as `build:migrate`) and run with `node worker.mjs` in the same Docker image (`CMD` overridden by Compose). Dev: `pnpm worker` (`tsx src/worker/index.ts`).

**Loop.**

1. Insert or refresh the heartbeat every 10 s.
2. **Claim** up to `WORKER_CONCURRENCY` jobs (default 4) with one statement: `UPDATE jobs SET status='RUNNING', locked_by=$id, locked_until=now()+interval '2 minutes', attempts=attempts+1, started_at=… WHERE id IN (SELECT id FROM jobs WHERE status='QUEUED' AND run_at <= now() AND queue = ANY($queues) ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT $n) RETURNING *`. Two workers never run the same job.
3. Run the handler with an `AbortSignal` and a **job context** (`ctx.log`, `ctx.extendLock()`, `ctx.userId`, `ctx.correlationId`).
4. On success: `SUCCEEDED`. On error: `FAILED` and re-queued with exponential backoff (`run_at = now() + min(30 s × 2^attempts, 1 h)` plus jitter) while `attempts < max_attempts`, else `DEAD` (kept for inspection 14 days). A handler may throw `PermanentError` to go straight to `DEAD`, or `RetryAfter(ms)` to choose the delay.
5. **Stale locks:** a reaper (every 30 s, run by every worker, idempotent) returns `RUNNING` jobs whose `locked_until` passed to `QUEUED`, counting the attempt. Long handlers call `ctx.extendLock()`.
6. Idle poll interval `WORKER_POLL_MS` (default 2 s), backing off to 10 s when empty; `LISTEN/NOTIFY` on enqueue is an optional speed-up, not required.
7. **Graceful shutdown:** on `SIGTERM`, stop claiming, let running jobs finish up to 30 s (then abort and re-queue), clear the heartbeat, exit 0.

**Scheduler.** Every worker ticks every 15 s: `SELECT … FROM job_schedules WHERE enabled AND next_run_at <= now() FOR UPDATE SKIP LOCKED`, enqueues the schedule's job with `dedupe_key = '<name>:<window>'` and advances `next_run_at`. The `dedupe_key` makes double-fires harmless even if two workers race.

**Enqueue API** (server code only): `enqueue({ type, payload, userId?, queue?, runAt?, dedupeKey?, maxAttempts? })` returning the job id (or the existing one on a dedupe hit). Enqueueing inside a mutation uses the **same transaction** as the write (so a rolled-back write never leaves a job).

**Handlers.** `src/worker/handlers/<area>.ts` export `{ type, queue, schema, run }`; the registry validates `payload` with Zod before running; an unknown `type` makes the job `DEAD` with a clear error (a newer release's job read by an older worker must not crash the loop).

---

## 4. Tick mode (serverless hosts)

A host with no long-running process (Vercel) cannot run the loop. Provide an alternative that uses the **same claim and handler code**:

- `POST /api/jobs/tick` with `Authorization: Bearer $JOBS_TICK_SECRET`. It runs the scheduler once and claims and runs jobs for up to 25 s (below the function limit), then returns `{ ran, remaining }`. Constant-time secret comparison; rate-limited; no user session.
- An external scheduler calls it (GitHub Actions `schedule` every 5 minutes is the free option; Vercel Hobby cron only runs daily, which is too coarse). Jobs are delayed by up to the call interval.
- Features must **not assume** low latency. Anything the user waits for (a transcription, an assistant answer) is also available through a synchronous path or an immediate tick; reminders accept the delay or require the Docker profile.
- ADR 0009 records the runtime choice and this mode.

---

## 5. Jobs shipped in this feature

| Type | Queue | When | Purpose |
|---|---|---|---|
| `system.ping` | default | manual and tests | proves enqueue → claim → run |
| `maintenance.prune_jobs` | default | daily | delete `SUCCEEDED` jobs older than 7 days, `DEAD` older than 14, old heartbeats |
| `maintenance.prune_sync` | default | daily | prune `change_log` and `sync_operations` older than 30 days (05) |
| `maintenance.prune_conflicts` | default | daily | remove resolved conflict content 30 days after resolution (05) |

Later features add: `attachment.verify`, `attachment.purge` (09), `embedding.index`, `embedding.backfill` (10), `calendar.sync` (12), `transcription.process`, `voice.cleanup` (13), `reminders.scan`, `notification.deliver`, `overdue.summary` (14), `review.generate` (15).

---

## 6. Health, observability, security

- `/api/health` gains `worker: "ok" | "stale" | "none"` from the freshest heartbeat (within 30 s = ok). **Informational only**: the HTTP status still depends on the database alone (a missing worker must not make the web app fail health checks).
- **Logs:** JSON lines on stdout with `level, time, msg, jobId, type, queue, userId, correlationId, attempt, durationMs, errorCode`. Never payloads, note text, transcripts, tokens or provider responses.
- **Metrics** (technical §14), exposed as counts through a log line every 60 s and a `getQueueStats()` query: queue depth by queue and status, oldest queued age, failures and dead by type, retries, average duration by type. These feed Settings → Sync and the runbook queries.
- **Settings → Sync → Background work:** the signed-in person's own pending counts per kind (embedding backlog, uploads to verify, transcriptions), failed jobs with a quiet "Try again" for ones that are safe to retry, never cross-user.
- **Security:** handlers derive ownership from `jobs.user_id`; payloads carry ids, not authority. `DEAD` job error text is redacted. The tick endpoint has its own secret and no cookies. The worker uses the same least-privilege database role as the web app.
- **Idempotency:** every handler is safe to run twice (jobs are at-least-once).
- **Config:** `WORKER_CONCURRENCY`, `WORKER_POLL_MS`, `WORKER_QUEUES` (default all), `JOBS_TICK_SECRET` (tick mode only). Added to `.env.example` and the env schema.

---

## 7. Compose

Local `docker-compose.yml` gains a `worker` service (profile `full`, same image, `command: ["node","worker.mjs"]`, `depends_on` healthy `db` and completed `migrate`, `restart: unless-stopped`, graceful stop period 40 s). Production Compose (feature 16) runs it by default. Without Docker, `pnpm worker` runs it natively beside `pnpm dev`.

---

## 8. Tests

**Unit**
- Backoff computation with jitter bounds; `PermanentError` and `RetryAfter` handling; payload validation per handler; dedupe key windows; schedule parsing and next-run computation.

**Integration** (real database)
- Two worker loops race on 50 jobs: each job runs exactly once.
- A failing handler retries with increasing `run_at` and ends `DEAD` after `max_attempts`; the dead job keeps a redacted error.
- A crashed worker (lock expired) has its job reclaimed and run once more, counting the attempt.
- `dedupe_key` allows one active job; a new one is accepted after the first finishes.
- Enqueue inside a transaction that rolls back leaves no job.
- Scheduler fires once per window with two workers.
- An unknown job type goes `DEAD` without stopping the loop.
- Tick endpoint: secret required (constant-time), runs jobs within its budget, no session accepted.
- Ownership: a handler for user A cannot read user B's rows even with a forged payload id.
- Health reports worker state without changing the HTTP status.

**E2E**
1. Enqueue `system.ping` from a test-only route (E2E mode) and see it succeed.
2. Settings → Sync → Background work shows only the person's own counts.
3. Killing the worker mid-job (in Docker or a spawned process) then restarting runs the job to completion once.

**Manual:** `docker compose --profile full up` runs web and worker together; `SIGTERM` drains cleanly.

---

## 9. Definition of done

- [ ] A worker process runs independently of the web app, from the same image, and processes jobs from the database
- [ ] Jobs are claimed exactly once, retried with backoff, dead-lettered with a redacted error, and recovered after a crash
- [ ] Scheduled jobs fire once per window even with several workers
- [ ] Health shows worker status without affecting the web health result
- [ ] Tick mode runs the same handlers on a serverless host through an authenticated endpoint
- [ ] Logs carry job and correlation ids and never content
- [ ] Settings → Sync → Background work shows the person's own backlog only
- [ ] ADR 0009 written before building
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `build:worker` pass
- [ ] `agent_docs/background-worker-and-jobs_v2.md` written and indexed

---

## 10. Out of scope (V2)

A separate queue product (Redis, SQS); multi-region workers; a job admin UI beyond the personal backlog; priorities beyond named queues; job chains or workflows; per-job cancellation from the UI.
