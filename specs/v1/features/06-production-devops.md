# Feature 06 — Production & DevOps

## 1. Scope

This feature takes the app from "runs on my laptop" to a real production deployment, and teaches each step along the way (DevOps spec §1).

- Multi-stage Dockerfile with Next.js standalone output
- Local and production Docker Compose
- Caddy reverse proxy with automatic HTTPS
- Migrations as a deployment step
- GitHub Actions CI and CD to a single Linux VM
- Structured logging, health checks
- Backups, restore, rollback
- Production setup for auth: OAuth apps, email domain, secrets

`04-devops-deployment-spec.md` is the detailed source of truth. This doc turns it into a build order, concrete files and acceptance checks.

---

## 2. Build timeline (interleaved with features 01–05)

Don't leave deployment until the end (project plan §1).

| Milestone (DevOps spec §25) | Build during | Deliverable |
|---|---|---|
| M1: Postgres in Docker locally | Feature 01 | `docker-compose.yml` `db` service |
| M2: Full app from a production image locally | End of 01 | Dockerfile + `--profile full` |
| M5: CI | Start of 02 | `.github/workflows/ci.yml` |
| M3: Manual deploy to VM | After 02 | VM provisioned, `docker-compose.prod.yml`, `scripts/deploy.sh` run by hand |
| M4: Caddy + HTTPS + real domain | After 02 | `Caddyfile`, DNS, OAuth apps + Resend configured for production |
| M6: CD | After 03 | `.github/workflows/deploy.yml` |
| M7: Rollback tested | After 05 | documented + rehearsed |
| M8: Restore from backup tested | After 05 | documented + rehearsed on a non-production copy |

Deploying real production early means auth (OAuth callbacks, HTTPS cookies, email) gets exercised in its real environment weeks before launch.

---

## 3. Files

```text
Dockerfile
.dockerignore
docker-compose.yml            # local: db (default), web (profile "full")
docker-compose.prod.yml       # production: caddy, web, db, migrate
Caddyfile
.env.example
.github/workflows/ci.yml
.github/workflows/deploy.yml
scripts/
  deploy.sh
  rollback.sh
  backup.sh
  restore.sh
  healthcheck.sh
docs/
  deployment.md               # VM setup, DNS, secrets, first deploy
  runbook.md                  # rollback, restore, troubleshooting commands
```

---

## 4. Docker image

Stages: `base` (node:24-alpine, corepack pnpm) → `deps` (`pnpm install --frozen-lockfile`) → `builder` (`pnpm build`, `output: "standalone"`) → `runtime`.

Runtime stage:
- Copies only `.next/standalone`, `.next/static`, `public`, the compiled migration runner and `drizzle/migrations`
- `USER node` (non-root), `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`
- `HEALTHCHECK` → `wget -qO- http://127.0.0.1:3000/api/health`
- No secrets as build args or `ENV`. All secrets are read at runtime. `NEXT_PUBLIC_APP_URL` is the only build-time public value, and CI provides it.
- Target image size under ~250 MB. `.dockerignore` excludes `.git`, `node_modules`, `.next`, `e2e`, `tests`, `.env*`.

**Migrations:** `scripts/migrate.ts` uses drizzle-orm's `migrate()` and is compiled into the image. The one-shot `migrate` service runs the same image with a different command, so no dev dependencies ship to production.

---

## 5. Compose

### Local (`docker-compose.yml`)
- `db`: postgres:17, port 5432 bound to `127.0.0.1` only, named volume `dayboard-db-dev`
- `web` (profile `full`): builds the Dockerfile, depends on a healthy `db`

### Production (`docker-compose.prod.yml`)

| Service | Image | Networks | Notes |
|---|---|---|---|
| `caddy` | caddy:2 | `public`, `internal` | ports 80, 443. Volumes `caddy-data`, `caddy-config`. |
| `web` | `ghcr.io/<owner>/dayboard:${IMAGE_TAG}` | `internal` | `env_file: /opt/dayboard/.env`, healthcheck, `restart: unless-stopped` |
| `migrate` | same image | `internal` | `command: node migrate.js`, `restart: "no"`, profile `migrate` |
| `db` | postgres:17 | `internal` only | named volume `dayboard-db`, **no published ports**, healthcheck `pg_isready` |

`IMAGE_TAG` is always an immutable `sha-<7>` tag (DevOps spec §13). The current and previous tags are recorded in `/opt/dayboard/.deploy-state`.

---

## 6. Caddy

```text
{$APP_DOMAIN} {
  encode zstd gzip
  reverse_proxy web:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    -Server
  }
}
```

Caddy sets `X-Forwarded-For`/`X-Forwarded-Proto`. The app trusts them because `web` is reachable only through Caddy on the internal network. A Content-Security-Policy is set by Next.js (`next.config` headers) rather than Caddy, so it can use nonces.

---

## 7. CI (`ci.yml`), on PRs and pushes to `main`

1. Checkout → setup Node 24 + pnpm with cache → `pnpm install --frozen-lockfile`
2. `pnpm lint` · `pnpm typecheck` · `pnpm test`
3. `pnpm build` (with `AI_PROVIDER=mock`, dummy non-secret env)
4. **Secret leak check:** fail if `.next/static` contains `AI_API_KEY`, `BETTER_AUTH_SECRET`, `sk-` or `re_` (Resend) patterns
5. Playwright E2E against a `postgres:17` service container: `pnpm db:migrate` → `pnpm start` → `pnpm test:e2e`. The console email sender and mock AI provider are used. No OAuth or email calls leave CI.
6. Upload the Playwright report on failure

Branch protection: `main` requires CI to pass.

---

## 8. CD (`deploy.yml`), on successful CI for `main`

1. Build image with Buildx, cache in GHCR. Tags: `sha-<7>` and `main`.
2. Push to GHCR.
3. SSH to the VM (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, pinned `known_hosts`).
4. Run `scripts/deploy.sh sha-<7>` on the VM:
   1. `docker compose pull web`
   2. `docker compose --profile migrate run --rm migrate`. **Abort on non-zero.**
   3. `IMAGE_TAG=sha-<7> docker compose up -d web caddy`
   4. Poll `https://$APP_DOMAIN/api/health` for up to 60s
   5. Healthy: write the tag to `.deploy-state`. Unhealthy: **automatically run `rollback.sh`** to the previous tag and exit non-zero.
5. The workflow run fails visibly if deploy fails (DevOps spec §18).

Concurrency group `deploy-production` ensures only one deploy runs at a time.

---

## 9. Production secrets

Stored in `/opt/dayboard/.env` on the VM (mode `600`, owned by the deploy user). Never in Git, the image or GitHub repository files.

| Group | Variables |
|---|---|
| Core | `NODE_ENV=production`, `DATABASE_URL`, `APP_DOMAIN`, `NEXT_PUBLIC_APP_URL` |
| Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://$APP_DOMAIN`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| AI | `AI_PROVIDER`, `AI_MODEL`, `AI_MODEL_FAST`, `AI_API_KEY`, limits |
| DB container | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |

The app connects with a **least-privilege role** (owner of the app schema, not superuser). GitHub Actions only holds deploy credentials (DevOps spec §19).

### Auth production checklist (`docs/deployment.md`)
- [ ] Production Google OAuth client: authorized origin `https://$APP_DOMAIN`, redirect `https://$APP_DOMAIN/api/auth/callback/google`. OAuth consent screen published (not "Testing"), or test users listed.
- [ ] Production GitHub OAuth app: callback `https://$APP_DOMAIN/api/auth/callback/github`
- [ ] Resend domain verified. SPF, DKIM and DMARC DNS records added.
- [ ] Sign-in via all four methods verified on production after the first HTTPS deploy
- [ ] `BETTER_AUTH_SECRET` generated uniquely for production. Rotating it signs everyone out, so this is documented.

---

## 10. Observability

- Logs: JSON lines on stdout (`level`, `time`, `msg`, `requestId`, `userId` where known, `feature`, `errorCode`). Docker `json-file` driver with `max-size: 10m`, `max-file: 5`.
- Request ID: generated in `proxy.ts` if absent, forwarded as `x-request-id`, included in error responses so users can report it.
- `GET /api/health`: `{ status: "ok", db: "ok", version: "<sha>" }`, 200. Returns 503 if the DB check (`SELECT 1`, 2s timeout) fails. No auth, no secrets.
- Startup log: environment, version, AI provider name (not the key), which auth providers are enabled.
- Runbook commands (DevOps spec §21): `docker compose ps`, `logs --tail=200 web`, `inspect`, `exec db psql`.

---

## 11. Backups, restore, rollback

**`backup.sh`** (cron daily at 02:00 VM time): `docker compose exec -T db pg_dump -Fc` → `/opt/dayboard/backups/backup-YYYY-MM-DD-HHMM.dump`. Keeps 14 daily and 8 weekly. Logs the size and exits non-zero on failure. The docs note that same-VM backups don't protect against losing the VM (off-site copies are V2).

**`restore.sh <file>`**: stop `web` → restore into a fresh database → run migrations → start `web` → health check. Rehearse on a non-production copy (M8), and write down the steps and time taken in the runbook.

**`rollback.sh [tag]`**: redeploys the previous (or given) image tag **without** running migrations, then health-checks. This relies on the migration policy:
- Migrations must be **backward-compatible with the previous release** (expand/contract, DevOps spec §14): add nullable columns or new tables first, and remove old ones in a later release.
- No destructive migration (drop/rename) ships in the same release as the code that stops using it.
- Reviewers check this on every PR that touches `drizzle/migrations`.

---

## 12. VM baseline (`docs/deployment.md`)

Ubuntu LTS · Docker Engine + Compose plugin · `ufw` allowing 22/80/443 only · SSH keys only, password auth and root login disabled · `unattended-upgrades` · timezone UTC · a deploy user in the `docker` group · `/opt/dayboard` holding the compose file, Caddyfile, `.env`, backups and scripts.

---

## 13. Definition of done

Everything in DevOps spec §27, plus:
- [ ] Deploy of a new SHA is fully automated from a merge to `main`
- [ ] A deliberately broken release (health endpoint forced to 503) auto-rolls back and the workflow fails
- [ ] Rollback and restore both rehearsed, with timings written in `docs/runbook.md`
- [ ] All four sign-in methods work on the production domain over HTTPS
- [ ] Secret leak check passes. `docker history` shows no secrets.
- [ ] Postgres port unreachable from the internet (verified with an external `nc`)

---

## 14. Out of scope (V1)

Kubernetes, multiple app replicas, blue/green or zero-downtime deploys, managed Postgres, off-site backup storage, Sentry/OpenTelemetry, a WAF. The architecture leaves room for each (DevOps spec §26).
