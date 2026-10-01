# V1 DevOps & Deployment Specification — Docker First

## 1. Purpose

Deployment is a first-class learning objective of this project.

The V1 deployment should teach and demonstrate:

- container image creation
- multi-stage Docker builds
- local Docker Compose
- production Docker Compose
- environment variables and secrets
- database migrations
- persistent database volumes
- reverse proxying
- HTTPS
- DNS
- health checks
- CI
- CD
- image registry
- remote deployment
- backups
- rollback
- logs

The production architecture should remain understandable enough to debug personally.

---

## 2. Target production architecture

Recommended initial deployment target:

- One Linux VPS/VM
- Docker Engine + Docker Compose plugin
- Caddy
- Next.js app container
- PostgreSQL container with persistent volume

```text
Internet
   |
 HTTPS :443
   |
   v
+----------------+
| Caddy           |
| TLS / reverse   |
| proxy            |
+--------+---------+
         |
         v
+----------------+
| Next.js         |
| application     |
+--------+---------+
         |
         v
+----------------+
| PostgreSQL      |
| persistent vol  |
+----------------+
```

This is intentionally a single-server architecture for V1.

A managed PostgreSQL service can be substituted later without redesigning the application.

---

## 3. Why use Caddy

Caddy keeps the V1 deployment easy to understand while still teaching real reverse-proxy concepts.

Responsibilities:

- listen on 80/443
- automatically provision/renew TLS certificates
- reverse proxy to Next.js
- expose only the necessary public ports

Next.js should not be directly exposed on the public internet in production.

---

## 4. Repository deployment files

Required files:

```text
Dockerfile
.dockerignore
docker-compose.yml
docker-compose.prod.yml
Caddyfile
.env.example
.github/workflows/ci.yml
.github/workflows/deploy.yml
scripts/
  deploy.sh
  backup.sh
```

Actual file naming can be adjusted, but the capabilities must remain.

---

## 5. Dockerfile requirements

Use a multi-stage build.

Stages should conceptually be:

1. base
2. dependencies
3. builder
4. runtime

Use Next.js standalone output.

`next.config` should enable:

```ts
output: "standalone"
```

Runtime image requirements:

- minimal dependencies
- non-root user where practical
- only necessary files
- production environment
- no dev source tree
- no package-manager cache

Do not run the container as root if avoidable.

---

## 6. Build-time vs runtime environment

Clearly separate:

### Build-time

- `NODE_ENV`
- public build variables only where truly required

### Runtime secrets

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- OAuth client secrets (`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`)
- AI provider secrets
- email provider secrets (`RESEND_API_KEY`)

Production also needs separate Google/GitHub OAuth apps whose callback URLs point to the production domain, plus a Resend-verified sending domain (SPF/DKIM/DMARC). See `features/06-production-devops.md` §9.

Never bake secrets into the Docker image.

---

## 7. Docker Compose — local development

Local development should support:

```bash
docker compose up -d db
pnpm dev
```

Recommended because Next.js documentation notes that local native development can be faster than running the Next.js dev server itself inside Docker on Mac/Windows.

Also provide a full-container smoke path:

```bash
docker compose --profile full up --build
```

This allows learning and validating container behavior without forcing the slowest workflow for every local edit.

---

## 8. Docker Compose — production

Production Compose should define:

- `web`
- `db`
- `caddy`
- optional `migrate` one-shot service

Example conceptual flow:

```text
migrate -> db
web -> db
caddy -> web
```

The migration step must finish successfully before a deployment is considered healthy.

---

## 9. Container health checks

Add an application health route:

`GET /api/health`

Minimum response when healthy:

```json
{
  "status": "ok"
}
```

The endpoint should also validate the critical runtime dependency if safe to do so, such as a lightweight database connectivity check.

Do not make health checks expensive.

Docker healthcheck for the app should query the internal app port.

---

## 10. Database persistence

PostgreSQL must use a named Docker volume in the single-VM deployment.

Do not rely on container filesystem persistence.

Example conceptual setup:

```text
postgres-data:/var/lib/postgresql/data
```

The database volume must not be deleted by normal deploy operations.

---

## 11. Database migrations

Use Drizzle migrations.

Rules:

- Every schema change produces a migration.
- Never modify an already-applied migration to fix a production database.
- Keep migrations committed to Git.
- Migration execution is a deployment step.
- Deployment must fail if migration fails.

Provide:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

`db:studio` is for local development only.

---

## 12. Deployment strategy

Preferred first implementation: SSH-based deployment from GitHub Actions to a single Linux VM.

High-level flow:

```text
Push to main
   |
   v
GitHub Actions
   |
   +-> lint
   +-> typecheck
   +-> unit tests
   +-> build
   +-> E2E tests
   |
   v
Build Docker image
   |
   v
Push image to GHCR
   |
   v
SSH to VM
   |
   v
Pull image
   |
   v
Run migration
   |
   v
docker compose up -d
   |
   v
Health check
   |
   v
Deployment complete
```

Do not deploy untested code directly from a laptop.

---

## 13. Image tagging

Every image should have at least:

- immutable Git SHA tag
- branch/environment tag where useful

Example:

```text
app:sha-abc1234
app:main
```

The deployment should prefer immutable SHA tags so rollback is deterministic.

---

## 14. Rollback

Rollback must be a documented command/procedure.

Conceptual flow:

```bash
docker compose pull
# select previous image tag
# restart web with previous image
```

Database migrations complicate rollback.

Therefore:

- Prefer backward-compatible database migrations.
- Avoid destructive schema changes in V1.
- For migrations that remove/rename data, use expand/contract patterns.

A deployment rollback means reverting the application image first. Database rollback should be treated as a separate, exceptional procedure.

---

## 15. Backups

At minimum implement a scheduled PostgreSQL logical backup.

Backup script should:

1. dump the database
2. compress it
3. timestamp it
4. write to a backup directory outside the database data volume
5. retain a limited number of backups

Example naming:

```text
backup-2026-09-18-0200.sql.gz
```

For learning, local backup storage is acceptable initially, but document that it is not sufficient protection against total VM loss.

V2 can move backups to object storage.

---

## 16. VM setup checklist

Production VM should have:

- Linux
- Docker Engine
- Docker Compose plugin
- firewall enabled
- only required ports exposed
- SSH key authentication
- no password-only SSH
- regular OS security updates
- timezone configured

Public ports should normally be limited to:

- 80/tcp
- 443/tcp
- SSH on a controlled port/interface as appropriate

PostgreSQL must not be publicly exposed.

---

## 17. DNS

Production setup should document:

```text
app.example.com -> VM public IP
```

Caddy uses the configured hostname to issue TLS certificates.

Do not hard-code the hostname in application code.

---

## 18. GitHub Actions

### CI workflow

Run on pull requests and pushes to main/develop as defined by repository policy.

Jobs:

1. install dependencies using lockfile
2. lint
3. typecheck
4. unit tests
5. build
6. Playwright E2E tests

The AI provider should be mocked in CI unless an explicit staging integration test is configured.

### CD workflow

After CI passes on main:

1. build image
2. push image
3. authenticate to VM
4. pull immutable image
5. run migrations
6. start/restart stack
7. wait for health
8. fail visibly if health does not pass

---

## 19. GitHub Actions secrets

Examples:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `GHCR_TOKEN` if needed by the chosen registry strategy

Production application secrets should remain on the VM or in a dedicated secrets system, not committed to GitHub repository files.

---

## 20. Deployment scripts

Provide simple scripts so the deployment mechanics can also be run manually.

Required conceptual scripts:

### `deploy.sh`

- pull image
- run migrations
- restart stack
- health check

### `backup.sh`

- create DB backup
- rotate old backups

### `healthcheck.sh` (optional)

- curl production health endpoint
- fail non-zero on unhealthy state

Scripts should use `set -euo pipefail` where shell compatibility allows.

---

## 21. Production logging

Application logs should go to stdout/stderr.

Docker should manage container logs; do not write application logs to files inside the container.

Deployment troubleshooting should teach:

```bash
docker compose ps
docker compose logs --tail=200 web
docker compose logs --tail=200 db
docker inspect <container>
```

Do not log secrets.

---

## 22. Security baseline

V1 deployment must include:

- HTTPS
- secure session cookies via auth library
- non-public database
- secrets outside image
- least-privilege DB credentials where practical
- no root app process where practical
- dependency lockfile
- automated dependency update awareness
- input validation
- auth checks on server
- AI request limits

Future hardening can add a dedicated security service/WAF.

---

## 23. Docker networking

Production Compose should use an internal application network.

Caddy needs access to web.
Web needs access to DB.
DB should not need access to Caddy.

Conceptually:

```text
public network
  |
  Caddy
    |
internal network
  |
  Web ---- DB
```

---

## 24. Environment files

Keep separate:

- `.env.example` in Git
- `.env.local` for local development (gitignored)
- production environment secrets on server

Never commit `.env` files containing real secrets.

---

## 25. Deployment observability milestones

V1 deployment learning milestones:

### Milestone 1

Run PostgreSQL via Docker locally.

### Milestone 2

Run complete app through a production Docker image locally.

### Milestone 3

Deploy Dockerized app to a VM without CI/CD.

### Milestone 4

Add Caddy and HTTPS.

### Milestone 5

Automate CI.

### Milestone 6

Automate CD.

### Milestone 7

Test rollback.

### Milestone 8

Test restore from a database backup.

The project is considered deployment-complete only after these are documented.

---

## 26. Optional managed alternatives

The architecture should allow:

- managed PostgreSQL instead of self-hosted PostgreSQL
- managed container registry
- managed secrets
- managed monitoring

Do not make a managed service a hard dependency for local development.

---

## 27. Production Definition of Done

- Docker image builds from a clean checkout.
- Image starts with only required runtime dependencies.
- Health endpoint returns healthy.
- Database persists across container recreation.
- Migrations run successfully.
- Caddy serves HTTPS.
- DNS points to the deployment.
- CI blocks broken main branch changes.
- CD deploys by immutable image tag.
- Rollback can restore the previous application image.
- Database backup can be created.
- Backup restore has been manually tested.
- Secrets are not present in Git or Docker image layers.
- PostgreSQL is not publicly accessible.
