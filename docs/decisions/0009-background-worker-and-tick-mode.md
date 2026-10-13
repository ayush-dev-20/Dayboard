# 0009. Background jobs: a database-backed queue, run by a worker process or by an authenticated tick

**Status:** Accepted
**Date:** 2026-10-13
**Phase:** V2

## Context

V2 feature 08 (`specs/v2/features/08-background-worker-and-jobs.md`) is the foundation for the later background work: attachment cleanup (09), embeddings (10), calendar sync (12), transcription (13), reminders (14) and weekly reviews (15). Some of it must run after the request has returned, and some must run on a schedule. The production host is Vercel with Neon Postgres. Vercel functions cannot run a loop, and their scheduled cron is too coarse on the free plan. Local development and the Docker profile can run a long-lived process.

## Decision

- **The queue lives in Postgres** (`jobs`, `worker_heartbeats`, `job_schedules`). Claiming uses `SELECT … FOR UPDATE SKIP LOCKED`, so no second queue product is needed, and an enqueue inside a mutation shares its transaction.
- **Two ways to run the same handlers:**
  1. A **worker process** (`src/worker/index.ts`, bundled as `dist/worker.mjs`, run from the same image). It heartbeats, claims, runs, reaps stale locks and fires schedules in a loop. It is used by local Docker and any host that runs long-lived processes.
  2. **Tick mode** (`POST /api/jobs/tick`, protected by `JOBS_TICK_SECRET`, compared in constant time). It runs the scheduler once and processes jobs for up to 25 seconds, then answers `{ ran, remaining }`. An external scheduler calls it. Production uses a scheduled GitHub Actions workflow every five minutes (the free option), because Vercel's free cron runs only once a day.
- **Tick mode and the worker share** `claimOne`, `runClaimed`, the handler registry and the scheduler. Nothing is duplicated.
- **Delivery is at least once.** Every handler must be safe to run twice. Exactly-once is not promised: a claim and its result are separate statements.
- **Retries** use exponential backoff from 30 seconds, capped at one hour, with jitter. A handler can throw `PermanentError` (straight to `DEAD`) or a retry delay. A job that is still `RUNNING` after its lock expires is reclaimed by any worker and counts as an attempt.
- **Scheduled jobs** get a `dedupe_key` made from the schedule name and its time slot, so two workers that both see a due schedule enqueue one job.

## Alternatives

- **A managed queue (Redis, SQS, QStash).** Better throughput and retries out of the box, but another paid service and another secret to manage, and it does not share a transaction with the write that enqueues. Rejected for V2; the spec puts it out of scope.
- **`LISTEN/NOTIFY` as the primary wake-up.** It does not work through a transaction-mode pooler such as Neon's, so it is an optional speed-up only.
- **Running jobs inside request handlers after the response (the current `after()` housekeeping).** It cannot retry, cannot run on a schedule, and loses work when the function is cut off. It stays for the cases that already use it, but new background work uses the queue.
- **Only tick mode.** Simpler to deploy, but it cannot hold long work and makes jobs wait up to the call interval. The worker process stays for local and Docker use.

## Consequences

- Latency: jobs in tick mode start within the calling interval (about five minutes in production). Nothing the person waits for may depend on a job alone; it needs a synchronous path or an immediate tick.
- The worker and the web app both connect to Postgres, so the pool and the database role must allow for both. Feature 06's least-privilege role applies to the worker as well.
- Jobs and their payloads must stay small and free of content (ids and parameters only). The payload is stored in the database.
- A new migration adds the tables and the seeded schedules (expand-only).
- Related: `docs/decisions/0007-sync-protocol-push-pull-change-log.md` (the prune jobs depend on the sync tables and on the pull's snapshot signal).
