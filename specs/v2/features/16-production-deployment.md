# Feature 16 — Production Deployment (V2)

## 1. Scope

V2 keeps the V1 **Docker-first** deployment model (product goal 11) and adds a worker, object storage, pgvector and a service worker to it. This feature completes what V1 feature 06 left unfinished and extends it.

- **Production Compose** with `caddy`, `web`, `worker`, `db` (pgvector) and a one-shot `migrate`
- **Caddy** with the headers, caching rules and CSP the V2 features need (service worker, manifest, uploads)
- **CI** and **CD** that build and deploy web and worker together, with automatic rollback
- **Secrets and environment** for every V2 variable
- **Backups, restore, rollback** that cover the database **and** object storage, rehearsed
- **Observability:** logs, health, the V2 metrics
- **Two documented deployment profiles:** a full Docker/VM profile, and a **serverless-lite** profile (Vercel + managed Postgres + object storage + an external ticker) for free hosting, with its honest limits

Starting point: the `Dockerfile` (multi-stage, standalone, non-root, health check), local `docker-compose.yml`, `scripts/migrate.ts` bundled into the image, `/api/health`, `scripts/check-client-bundle.mjs`, env validation. **Not present:** `docker-compose.prod.yml`, `Caddyfile`, `.github/workflows/*`, deploy/backup/restore/rollback scripts, `docs/deployment.md`, `docs/runbook.md`. V1 feature 06 (`../../v1/features/06-production-devops.md`) stays the detailed reference for those; this doc lists only what is new or changed for V2.

Source spec sections: product goal 11; V2 DevOps spec (`../04-devops-deployment-spec.md`); technical §12, §13, §14; project plan Phases 10 and the V2 definition of done (engineering).

---

## 2. Start early

Like V1, deployment is not left to the end:

| When | Do |
|---|---|
| With 03 | CI (`ci.yml`) with the service worker build and manifest checks |
| With 08 | `worker` service in local Compose; worker entry in the image |
| With 09, 10 | pgvector database image, MinIO (or the `memory` storage driver) for CI and local |
| After 05 | A production deploy of the offline/sync stack to a real VM or serverless-lite environment, so the service worker, HTTPS cookies, OAuth callbacks and sync run in their real environment weeks before release |
| After 15 | Finish CD, backup rehearsal, rollback rehearsal, runbook timings |

---

## 3. Image and Compose

### Image

One image, three commands (V1 pattern): web (`node server.js`), migrate (`node migrate.mjs`), worker (`node worker.mjs`, built by `build:worker`, feature 08). Additions:

- The service worker file `public/sw.js` is part of the build output (feature 03).
- `pnpm build:worker` runs in the builder stage; `dist/worker.mjs` is copied to the runtime stage.
- `NEXT_PUBLIC_APP_URL` becomes a **build argument** (`ARG NEXT_PUBLIC_APP_URL`), because it is baked into metadata, `robots.txt` and `sitemap.xml`. CI passes it. (Today the Dockerfile has no such argument, so images carry `http://localhost:3000`.)
- No secrets as build arguments or `ENV`. `APP_VERSION` build arg continues (`sha-<7>`).
- Target size stays under about 250 MB; the worker adds only its bundle.

### `docker-compose.prod.yml`

| Service | Image / command | Networks | Notes |
|---|---|---|---|
| `caddy` | `caddy:2` | `public`, `internal` | ports 80 and 443; volumes `caddy-data`, `caddy-config`; the Caddyfile (§4) |
| `web` | `ghcr.io/<owner>/dayboard:${IMAGE_TAG}` | `internal` | `env_file: /opt/dayboard/.env`, healthcheck on `/api/health`, `restart: unless-stopped` |
| `worker` | same image, `command: ["node","worker.mjs"]` | `internal` | same env file, `stop_grace_period: 40s`, `restart: unless-stopped`; health by heartbeat (`node worker.mjs --healthcheck` reads the heartbeat row) |
| `migrate` | same image, `command: ["node","migrate.mjs"]` | `internal` | profile `migrate`, `restart: "no"` |
| `db` | `pgvector/pgvector:pg17` | `internal` only | named volume, **no published ports**, healthcheck `pg_isready`; init script creates the `vector` extension |
| `minio` (optional, profile `storage`) | `minio/minio` | `internal` | for self-hosted object storage; production normally uses R2 or S3 |

`IMAGE_TAG` is always an immutable `sha-<7>`; web and worker always run the **same tag**. Logs use the `json-file` driver with `max-size: 10m`, `max-file: 5`.

### Extension and privileges

`CREATE EXTENSION vector` needs privileges that the application role should not have. The db init script and the `migrate` step's role handle it once; managed Postgres enables the extension in its dashboard. Document both. The application connects with a **least-privilege role** (owner of the app schema, not superuser).

---

## 4. Caddy

Extends the V1 Caddyfile (`{$APP_DOMAIN}`, `encode zstd gzip`, `reverse_proxy web:3000`, security headers, `-Server`):

- **Service worker and manifest:** `/sw.js` served with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`; `/manifest.webmanifest` short cache; `/_next/static/*` immutable one-year cache.
- **No caching of `/api/*`** and authenticated HTML at the proxy; uploads and downloads go **directly to object storage**, so no large request bodies pass through Caddy (keep the default body limit modest).
- **Content-Security-Policy** (set by Next.js with nonces, not Caddy): `connect-src` allows the storage origin (presigned uploads) and Google OAuth endpoints; `img-src` allows `data:` (bookmark favicons) and the storage origin if images are served by redirect; `worker-src 'self'`; `frame-ancestors 'none'`. Add a test that the policy contains each required origin.
- **Timeouts:** raise the upstream read timeout to cover streaming AI responses (60 s) and keep it bounded.
- `X-Forwarded-*` trusted only because `web` is reachable solely through Caddy.
- HSTS stays; `Permissions-Policy` allows `microphone=(self)` (voice capture, feature 13) while keeping camera and geolocation off.

Object storage CORS (documented, not Caddy): allow `PUT` and `GET` from the app origin only, with the headers the upload uses.

---

## 5. Environment and secrets

`/opt/dayboard/.env` (mode 600, owned by the deploy user; never in Git, the image or GitHub repo files). New variables, all added to `.env.example` and `src/lib/env-schema.ts` with the existing "set both or neither" and production checks:

| Group | Variables |
|---|---|
| Worker (08) | `WORKER_CONCURRENCY`, `WORKER_POLL_MS`, `WORKER_QUEUES`, `JOBS_TICK_SECRET` (tick mode only) |
| Storage (09, 13) | `STORAGE_DRIVER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`, `STORAGE_QUOTA_MB` |
| Search (10) | `EMBED_DAILY_LIMIT`; embedding model uses the existing AI key |
| Calendar (12) | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` |
| Push (14) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Ops | `OPS_TOKEN` (optional, for `/api/ops/metrics`) |

Rules: **production fails to start** if a feature's variables are half-set (for example storage with no bucket); a feature whose variables are all absent is simply off and its UI hidden. `TOKEN_ENCRYPTION_KEY` and `VAPID_PRIVATE_KEY` are generated once and **never rotated casually**: document what rotating each one does (calendar tokens re-encrypted by key id; VAPID rotation invalidates all push subscriptions).

The secret leak check (`check:bundle`) extends its patterns to `VAPID_PRIVATE_KEY`, `TOKEN_ENCRYPTION_KEY`, `STORAGE_SECRET_ACCESS_KEY`, `JOBS_TICK_SECRET` and Google client secrets.

---

## 6. CI (`.github/workflows/ci.yml`)

On pull requests and pushes to `main`:

1. Checkout; Node 24 and pnpm with cache; `pnpm install --frozen-lockfile`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm theme:check`.
3. `pnpm test:integration` against a **`pgvector/pgvector:pg17`** service container (extension created in setup), with `STORAGE_DRIVER=memory`, mock AI, mock calendar and mock push.
4. `pnpm build` (including `build:migrate`, `build:worker`, the service worker) with dummy non-secret env and `AI_PROVIDER=mock`.
5. `pnpm check:bundle` with the extended secret patterns.
6. **PWA checks:** manifest valid (members, icons present and the right size), `sw.js` emitted, no `/api` caches in the worker's source.
7. Playwright E2E against the built app: migrate, start the web app and the **worker** as a second process, run `pnpm test:e2e` (offline cases use `context.setOffline`; AI, calendar, storage and push are mocks; fake media for voice). Upload the report on failure.
8. Docker: build the image (`docker build`), start Compose `--profile full` (web, worker, db), hit `/api/health`, confirm `worker: ok`.

Branch protection: `main` requires CI. **Zero paid calls** (no AI provider, no Google, no Resend).

---

## 7. CD (`.github/workflows/deploy.yml`)

On successful CI for `main`, concurrency group `deploy-production`:

1. Buildx build with the `NEXT_PUBLIC_APP_URL` and `APP_VERSION` args; push `sha-<7>` and `main` to GHCR.
2. SSH to the VM with pinned `known_hosts` and run `scripts/deploy.sh sha-<7>`:
   1. `docker compose pull web worker`
   2. Run the migration step; **abort on non-zero** (V1 rule).
   3. `IMAGE_TAG=sha-<7> docker compose up -d web worker caddy`
   4. Poll `https://$APP_DOMAIN/api/health` for up to 60 s, and require `worker: ok` within 90 s.
   5. Healthy → record the tag in `.deploy-state`. Unhealthy → **run `rollback.sh` automatically** to the previous tag and fail the workflow.
3. A deliberately broken release (health forced to 503 and, separately, worker never starting) auto-rolls back and fails the run.

**Compatibility rules for rollback** (extend V1's expand/contract policy):

- Migrations stay backward-compatible with the previous release (no drop or rename in the same release that stops using it).
- **Job payloads carry `payload_version`**; the previous worker must tolerate payloads the new web app enqueued, or those jobs go `DEAD` and are re-enqueueable (feature 08). Reviewers check this on every PR that adds a job type or changes a payload.
- The service worker and API keep a one-release compatibility window (`x-app-version`, `APP_OUTDATED`, feature 03).
- Rollback does **not** run migrations; the sync tables (`change_log`, `sync_operations`) must keep working with the old code (additive columns only).

---

## 8. Backups, restore, rollback

**Backup (`backup.sh`, daily 02:00):** `pg_dump -Fc` of the database (includes pgvector data; embeddings can also be rebuilt, so a restore may skip them and re-index) plus a **manifest of attachment keys**; object storage is backed up by the provider's versioning/replication or `rclone sync` to a second bucket. Keeps 14 daily and 8 weekly. Logs size and exits non-zero on failure. Off-site copies are **recommended and documented** (same-VM backups do not survive losing the VM).

**Restore (`restore.sh <file>`):** stop `web` and `worker` → restore into a fresh database → `CREATE EXTENSION vector` → migrations → restore or re-point storage → start `web`, then `worker` → health checks → trigger `embedding.backfill` if embeddings were skipped. **Rehearse** on a non-production copy and write the timings in `docs/runbook.md`. The rehearsal must prove: a note with an image attachment restores with its image; the sync tables restore consistently (devices pull and converge); scheduled jobs resume without duplicates.

**Rollback (`rollback.sh [tag]`):** redeploys the previous or given tag for **web and worker together**, without migrations, then health-checks both. Rehearsed and timed.

---

## 9. Observability

- Structured JSON logs from web and worker with request/correlation ids carried through enqueue → job (feature 08).
- `/api/health`: `{ status, db, worker, version }` (503 only for the database).
- **Metrics** (technical §14), available as log lines every minute and through an optional `GET /api/ops/metrics` (bearer `OPS_TOKEN`, JSON): sync success and failure rate, average push latency, queue depth and oldest job age by queue, dead jobs by type, AI latency and failure rate, embedding backlog, transcription failures, upload failures, push attempts and failures.
- **Runbook queries** (`docs/runbook.md`): SQL to inspect `jobs`, `sync_operations`, `sync_conflicts`, `notification_log`; commands for `docker compose logs --tail=200 web worker`, `ps`, restarting the worker, draining it, re-enqueueing dead jobs.
- Alerts are out of scope; the runbook says what to look at and where.

---

## 10. Deployment profiles

### Profile A: Docker on a VM (reference)

Everything above: Caddy, web, worker, pgvector Postgres, optional MinIO or R2/S3, CI/CD over SSH. All V2 features work with their intended latency (reminders to the minute, jobs near-instant).

### Profile B: serverless-lite (free hosting)

For a personal deployment on a host such as **Vercel** with managed Postgres (Neon, pgvector enabled) and an S3-compatible bucket (Backblaze B2 by default, see feature 09 §3; Cloudflare R2 also works). What is different:

| Area | Behaviour |
|---|---|
| Web | Next.js on the serverless host (no Docker image used) |
| Database | managed Postgres with the `vector` extension enabled; pooled URL for the app (`prepare: false`), direct URL for migrations |
| Worker | **none**. Jobs run in **tick mode** (feature 08): an external schedule (GitHub Actions `schedule`, every 5 minutes at best on the free tier) calls `POST /api/jobs/tick`. Hobby-tier platform cron is daily only and is not enough |
| Latency | jobs, embeddings, calendar sync, reminders and push are delayed by up to the tick interval; reminders are therefore approximate (say so in Settings → Notifications) |
| Immediate paths | transcription and review generation use their inline paths (features 13 and 15) so the person is not left waiting for a tick |
| Storage | external bucket (R2 free tier is generous); CORS configured |
| Service worker, manifest, offline, sync, views, editor, clipboard | **fully available** (they are client-side) |
| Restrictions | no long-running streams beyond the host's function limit (assistant answers must fit); serverless cold starts; hosting terms (for example non-commercial use on Vercel Hobby) |
| Migrations | run from CI or a laptop with the direct URL before deploy (no migration step on the host) |

Profile B is documented in `docs/deployment.md` with the exact environment variables and the degradations listed above, so the person knows what they trade for $0. The `docs/research/2026-10-04-free-deployment.md` note is the starting point.

---

## 11. Tests and verification

- **CI** as §6 (it is the test suite for this feature).
- **Script tests:** shell scripts checked with `shellcheck` in CI; `deploy.sh`, `rollback.sh`, `backup.sh`, `restore.sh` run against a Compose stack in a CI job (a smoke deploy with a deliberately broken tag to prove auto-rollback).
- **Config tests (Vitest):** env schema rejects half-configured features, accepts all-absent; secret patterns in `check:bundle` catch planted fakes.
- **Manual (recorded in the as-built doc with timings):** first deploy on a real VM over HTTPS; sign-in, install, offline, sync from a second device; upload and download an attachment; semantic search after indexing; calendar connect; push reminder to a phone; voice capture; weekly review generated by the worker; rollback rehearsal; restore rehearsal including attachments; Postgres port unreachable from the internet (external `nc`); `docker history` shows no secrets.

---

## 12. Definition of done

Everything in the V2 plan's engineering list, plus:

- [ ] CI passes with pgvector, the worker, mock providers and the PWA checks; Docker production build passes and `worker: ok` in the smoke stack
- [ ] A merge to `main` deploys web **and** worker automatically; a deliberately broken release (health 503; worker down) rolls back automatically and fails the workflow
- [ ] The worker runs independently of the web app, restarts cleanly, drains on stop
- [ ] Rollback and restore are documented, rehearsed and timed, and the restore includes attachments and sync state
- [ ] All V2 environment variables are validated; half-configured features refuse to start; secrets never reach the client bundle
- [ ] The service worker, manifest, CSP and storage CORS work over HTTPS in production
- [ ] Profile B (serverless-lite) is documented with its limits, and tick mode is tested
- [ ] Postgres and object storage are not reachable from the internet except through their intended paths
- [ ] `docs/deployment.md` and `docs/runbook.md` written; `agent_docs/production-deployment_v2.md` written and indexed (this also closes `production-devops_v1`)

---

## 13. Out of scope (V2)

Kubernetes; multiple web replicas; blue/green or zero-downtime deploys; managed queue products; multi-region; a WAF; Sentry or OpenTelemetry; alerting and paging; automatic off-site backup tooling (recommended and documented only); auto-scaling workers.
