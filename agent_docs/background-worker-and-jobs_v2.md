# Feature: Background worker and jobs

**Phase:** V2 (feature 08)
**Status:** In progress. The queue, the worker process, the scheduler, tick mode, health, and the first maintenance jobs are built and tested against the real database. Not built: the Settings → Sync → Background work panel, the test-only E2E route, the prune job for conflicts, and any check of the Docker image or Compose service (Docker is not installed here).
**Date:** 2026-10-13

## What was built

- **Queue in Postgres** (`jobs`, `worker_heartbeats`, `job_schedules`, migration `0012`; `sync_retention`, migration `0013`). A claim is one statement with `FOR UPDATE SKIP LOCKED`, so two workers never take the same job (`src/lib/jobs/claim.ts`).
- **Runner** (`src/lib/jobs/runner.ts`): validates the payload with the handler's Zod schema, runs it under a time limit and an abort signal, and records the result. Failures retry with 30 s doubling to 1 h plus jitter, then go `DEAD` with a redacted error. `PermanentError` goes straight to `DEAD`, `RetryAfter(ms)` sets the delay. Every write is guarded by the worker's id, so a stalled worker's late answer cannot overwrite a job that was reclaimed.
- **Crash recovery:** a reaper returns `RUNNING` jobs whose lock ran out to the queue (counting the attempt), or to `DEAD` when no attempts are left.
- **Scheduler** (`maintenance.ts`, `fireDueSchedules`): each due schedule enqueues one job per time slot (`name@slot` dedupe key), and missed slots are skipped, not replayed. Cadence forms: `every 60s|5m|2h`, `daily 03:00 UTC`.
- **Worker process** (`src/worker/index.ts`, loop in `src/lib/jobs/worker-loop.ts`): heartbeat every 10 s, claim loop with polling that backs off to 10 s, reaper every 30 s, scheduler every 15 s, a stats log line every 60 s, and a graceful stop (running jobs finish for up to 30 s, then are stopped and returned to the queue). `pnpm worker` runs it; `pnpm build:worker` bundles `dist/worker.mjs`.
- **Tick mode** (`POST /api/jobs/tick`, ADR 0009): bearer secret compared in constant time, runs the scheduler, the reaper and jobs for up to 25 s, answers `{ ran, remaining }`. It answers 404 when `JOBS_TICK_SECRET` is not set, and takes no session or cookies. `.github/workflows/jobs-tick.yml` calls it every five minutes.
- **Health:** `/api/health` gains `worker: "ok" | "stale" | "none"` (freshest heartbeat within 30 s is `ok`). It never changes the status code.
- **Jobs shipped:** `system.ping`, `maintenance.prune_jobs` (daily 03:00 UTC), `maintenance.prune_sync` (daily 03:15 UTC), seeded by migration.
- **Sync log pruning is safe for devices that fall behind:** `prune_sync` deletes only rows older than 30 days and records the highest removed position in `sync_retention`. `GET /api/sync/pull` answers `{ snapshotRequired: true, headCursor }` for a cursor below that floor, and the device engine takes a snapshot and continues from the head.

## Why

Later features need work that runs after a request returns or on a schedule. Production is Vercel + Neon, where no loop can run, so the same handlers run either in a worker process (local, Docker, any long-lived host) or in tick mode. See ADR 0009.

## What was deferred

- **Settings → Sync → Background work** (the person's own backlog and "Try again"): the Settings → Sync page does not exist yet (feature 05 UI).
- **`maintenance.prune_conflicts`:** no conflict records exist yet (feature 05, later slice).
- **E2E:** the spec's test-only enqueue route and the three E2E cases. Coverage is in `tests/integration/jobs.test.ts` and the worker smoke test below.
- **Request-level rate limit on tick:** the secret is the control. Nothing counts calls.
- **Docker image and Compose `worker` service:** written, not run (Docker is not installed on this machine).
- **`LISTEN/NOTIFY`:** optional in the spec, not built.

## Deviations from the spec

- A job waiting to retry has status `FAILED` and is claimed like a queued one once its time comes. The partial unique index for `dedupe_key` covers `QUEUED` and `RUNNING` only, as specified, so a key is free again while a job waits to retry.
- Handlers log through `ctx.log`; the built-in `system.ping` logs its `message`, which is test data. Real handlers must not log content.
- `maintenance.prune_sync` removes rows by age and records a floor, rather than deleting everything at or below the newest old row. The spec's wording would delete recent rows if positions and times ever disagreed.

## Related files

- `src/db/schema/jobs.ts`, `src/db/schema/sync.ts` (`syncRetention`), migrations `0012`, `0013`.
- `src/lib/jobs/`: `types.ts`, `retry.ts`, `schedule.ts`, `registry.ts`, `enqueue.ts`, `claim.ts`, `runner.ts`, `maintenance.ts` (heartbeat, scheduler, tick, health, stats, prune jobs), `worker-loop.ts`, `builtin.ts`, `secret.ts`.
- `src/worker/index.ts`: the process entry. `src/app/api/jobs/tick/route.ts`: tick mode. `src/app/api/health/route.ts`: the worker field.
- `src/db/queries/sync.ts` and `src/lib/local/engine.ts`: the snapshot signal and its handling.
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/jobs-tick.yml`, `.env.example`.
- Tests: `tests/unit/jobs-pure.test.ts`, `jobs-secret.test.ts`; `tests/integration/jobs.test.ts` (23 cases on the real database: racing workers, retries, crash recovery, dedupe, rollback, scheduler, drain and stop, health, tick, prune jobs); `tests/integration/sync-engine-server.test.ts` (snapshot after pruning).

## Hand-off notes

- **To add a job type:** write a handler `{ type, queue, schema, run }`, register it (`registerHandler`; built-ins go through `ensureBuiltinHandlers`), and call `enqueue(tx, …)` inside the write that needs it. Handlers must be safe to run twice (delivery is at least once), take the person from `ctx.userId`, and never log content.
- **Every entry point must register handlers before running jobs:** the worker, the tick route and tests call `ensureBuiltinHandlers()`.
- **To turn tick mode on for production:** set `JOBS_TICK_SECRET` (32+ characters) in the host's environment, and add `APP_URL` and `JOBS_TICK_SECRET` as GitHub repository secrets. Until both exist the workflow exits without calling anything.
- **Migrations 0012 and 0013** are applied to the test database. The dev database and Neon still need them (ask first for Neon).
- Jobs run through the shared `db` client (3 connections, no prepared statements). A worker with high concurrency waits for a free connection; raise the pool if this shows up.
- Related: `sync-engine_v2.md` (pruning and the snapshot signal), ADR 0007 and 0009.
