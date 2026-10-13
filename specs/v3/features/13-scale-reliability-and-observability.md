# Feature 13 — Scale, Reliability & Observability (V3)

> **Build position: thirteenth V3 feature, started early** (V3 plan phase 10). Like V1 feature 06 and V2 feature 16, deployment and observability are not left to the end: the first slice (correlation ids, health, staging) should land with feature 05, because live collaboration is the first V3 piece that is hard to debug without them. Behaviour is in V3 technical spec §11 to §14 and the V3 DevOps spec. There is no product-spec section; the owner-facing part is a small operator page. Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- **Correlation ids** end to end: HTTP requests, jobs, automation runs, agent runs, domain events and collaboration sessions.
- **Structured logs, metrics, traces** and a short list of **alerts**, with product-level dashboards (collaboration, workflows, AI, approvals, queues) apart from infrastructure ones.
- An **operator page** (`/admin`), read-only and content-free: health, backlogs, usage and cost.
- **Production topology** for V3: web, worker, collaboration service, PostgreSQL, object storage, Caddy; **staging** with isolated data; documented infrastructure.
- **Reliability work:** load tests, WebSocket reconnect and chaos tests, queue tuning, a **backup and restore drill**, a **rollback drill**.
- **Supply chain and security checks in CI:** audit, image scan, secret scan, lockfile check, SBOM.
- **Cost accounting** per feature and per person for AI.
- **Security hardening** that V3 needs (rate limits, abuse limits, CSRF, secret rotation, step-up) with tests.

Reuses: V1 feature 06 and V2 feature 16 (Dockerfile, Compose, Caddy, CI/CD, backups, `docs/deployment.md`, `docs/runbook.md`), `/api/health`, the logger (`src/lib/logger.ts`), `ai_usage`, V2 feature 08's `worker_heartbeats` and jobs, feature 05's service, feature 07's diagnostics, `scripts/check-client-bundle.mjs`.

Packages (ADR 0024 first; licenses checked with `npm view` on 2026-10-13): `@opentelemetry/api` (Apache-2.0) with `@vercel/otel` (MIT) for Next.js traces, and `prom-client` (Apache-2.0) for the metrics endpoint. Load tests use `autocannon` (MIT) as a development tool plus a small Node script that drives `@hocuspocus/provider` for WebSocket load. Command-line tools used in CI and drills are not dependencies: Trivy (image scan), gitleaks (secret scan), a CycloneDX/Syft SBOM step. k6 is AGPL-3.0, which is acceptable for a test tool that is not shipped, but it is not required, and the choice is recorded in the ADR.

Source spec sections: V3 technical spec §11 to §14, V3 DevOps spec §2 to §13, `../Agent.md` §10, project plan phase 10 and the V3 definition of done (engineering).

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Correlation ids, log shape, `/api/health` v2, staging environment, CI checks (audit, scan, secrets, lockfile, SBOM) | Every request can be followed; CI blocks unsafe builds |
| **B** | Metrics and traces, product dashboards, alerts, operator page | The owner can see the system |
| **C** | Load and chaos tests, queue tuning, backup and restore drill, rollback drill, cost accounting, runbook | Confidence before turning collaboration and automations on broadly |

---

## 2. Correlation ids

- A **correlation id** (UUID v7) is created at the edge of every unit of work and carried in `AsyncLocalStorage`: an incoming request (read `x-request-id` from Caddy if present), a job run, an automation run, an agent run, a collaboration session (feature 05), a domain event (feature 07, `correlation_id`).
- It appears on **every log line**, on the event rows and job rows it creates, in trace attributes, and in the `x-request-id` response header. Errors shown to people include a short support code derived from it ("Reference 7F3K9"), never a stack trace.
- Child work records the parent: events carry `causation_id`; agent steps and automation steps carry the run id.
- **Never log private content** (`../Agent.md` §10): no note, task, comment, memory, prompt, transcript, scene or email text; titles and names are not logged either. Logs carry ids, kinds, counts and timings. A test runs the main flows with the mock providers and asserts that none of a set of marker strings seeded into content ever appears in captured log output.

---

## 3. Health, logs, metrics, traces

**Health.** `GET /api/health` (liveness: process up) and `GET /api/health/ready` (readiness: database reachable, migrations at the expected version, worker heartbeat recent, collaboration service reachable when `COLLAB_URL` is set, storage reachable when configured). Readiness returns a small JSON of check names and booleans only. Caddy and Compose use readiness for rollout and rollback.

**Logs.** JSON lines to stdout: `time`, `level`, `msg`, `correlationId`, `component`, plus ids and counts. One logger (`src/lib/logger.ts`); no `console.log` in app code (lint rule).

**Metrics** (`GET /api/metrics`, Prometheus text format, protected by `METRICS_TOKEN` or the internal network; off by default):

| Area | Metrics |
|---|---|
| HTTP | request count, duration histogram, errors by route group |
| Database | query duration histogram (by operation kind), pool wait, connection count |
| Collaboration | active connections, documents open, update latency, projection lag, rejected updates |
| Events and jobs | pending deliveries, oldest pending age, retries, dead letters, job duration by type, heartbeat age |
| Automations | runs by status, run duration, approval wait time, rate-cap hits |
| Agents | runs by status, steps per run, tool calls by tool and outcome, approval wait time |
| AI | calls by feature, tokens, latency, fallbacks used (model fallback from ADR 0004), estimated cost |
| Storage | upload and download counts and errors |

Metric names and labels contain no user ids or content (labels are bounded: feature, status, route group, tool name).

**Traces.** OpenTelemetry through `@vercel/otel`, sampled at a low rate in production (1%) and fully in staging, exporting through the standard OTLP environment variables to whatever the operator runs; unset means no export. Spans cover requests, server actions, database calls, job runs, tool calls and provider calls, with the correlation id as an attribute.

**Dashboards.** `docs/observability/` holds dashboard definitions as JSON for a standard Grafana (kept as files, not required to run) in two sets: **infrastructure** (CPU, memory, database, disk) and **product** (collaboration connections and update latency, workflow success rate, AI tool calls and cost, approval wait, queue latency). Neither is needed to run the app.

---

## 4. Alerts (minimum production set, V3 DevOps spec §10)

Defined as rules in `docs/observability/alerts.yml` with a runbook link each:

- error rate above 2% of requests for 5 minutes
- database saturation (pool wait above 500 ms, or connections above 80%)
- event or job backlog: oldest pending older than 5 minutes
- worker heartbeat missing for 2 minutes
- collaboration service unavailable, or projection lag above 30 seconds
- storage failure spike
- automation rate-cap or repeated-failure disables above a threshold
- AI provider errors above 20% for 10 minutes (model fallback in use)
- disk or backup age (a backup older than 26 hours)

Alert delivery (email or chat) is the operator's choice and not built here.

---

## 5. The operator page (`/admin`)

For the owner of the deployment, not for ordinary people.

- **Access:** only accounts listed in `ADMIN_EMAILS` (an environment list, verified emails only), with a fresh session. Everyone else gets `NOT_FOUND`. There is no admin role in the database and no way to become one from the app.
- **Content-free, read-only:** counts and timings only. No person's notes, tasks, comments, titles, names or emails are shown, and no action can read or change a person's data from here.
- **Sections:** health checks (the readiness list), jobs and events (counts by status, oldest pending), collaboration (open documents, connections), automations and agents (runs by status in the last day), AI (calls, tokens, estimated cost by feature, fallback rate), storage (bytes used against the limit), accounts (total, active in 7 and 30 days, pending deletions), and build info (version, git SHA, migration version).
- Computed from the database and the in-process metrics; cached for 30 seconds.

---

## 6. Topology and environments

Reference topology (V3 DevOps spec §2): CDN or WAF (optional) → Caddy → **web** (Next.js), **collab** (feature 05), → PostgreSQL; **worker** and the event/job tables; object storage. One Docker image with several commands (web, migrate, worker, collab).

- **Compose profiles:** `docker-compose.prod.yml` adds the `collab` service and its Caddy route; local Compose gains it behind a `collab` profile so the default `pnpm dev` stays light.
- **Environments:** `local`, `staging` and `production`. **Staging** uses its own database, its own storage bucket and credentials, mock or capped AI keys, and a separate domain; it receives every merge to main, runs the smoke and e2e suites against the deployed stack, and promotes the same image digest to production. No production data is ever copied to staging; a seed script fills it.
- **Images** are immutable, tagged with the git SHA and the release version, never relying on `latest` for rollback; pushed to GHCR; scanned before deploy.
- **Deploy order** (DevOps spec §6): build → checks and scans → push → migrate → web → worker → collab → smoke → monitor → promote.
- **Scaling:** one instance of each service is the baseline. If the collaboration service ever needs more than one instance, it uses a shared pub/sub layer (Redis, decided in the ADR then) and sticky routing for WebSockets; until measurements show the need, it does not.
- **Infrastructure as code:** documentation only until components justify it (V3 DevOps spec §4): `docs/infrastructure.md` describes compute, network, storage, database, DNS and secrets so they could be written as Terraform or OpenTofu modules later.
- **Hosting limit:** the serverless-lite profile (Vercel and a managed Postgres) cannot run `collab` or a long-lived worker. It keeps working without live editing and with tick-mode jobs, and the docs say exactly which V3 features degrade (live editing off; agent runs and automations run only on ticks).
- **The canvas** serves Excalidraw's fonts and assets from our own origin; the image must contain `public/excalidraw/`, and the production check confirms nothing is fetched from a third-party CDN at runtime.

---

## 7. Reliability drills

All drills are scripted where possible, run in staging, and written up in `docs/runbook.md` with real timings.

1. **Load tests.** `autocannon` scripts for the critical endpoints (sign-in, task list, note read and save, search, comments, an automation trigger) with targets stated in the runbook (for example, p95 under 400 ms at 50 concurrent users on the staging size). A WebSocket script opens 50 documents with 4 editors each and measures update latency and projection lag.
2. **WebSocket reconnect.** Kill and restart `collab`, drop the network for 30 seconds, and rotate the token secret: editors reconnect with no lost or duplicated edits (the feature 05 test, run against the deployed stack).
3. **Queue behaviour.** Fill the event and job queues, kill a worker mid-job, run two workers at once: nothing is lost, nothing runs twice, backlog drains at the expected rate; tune `WORKER_CONCURRENCY` and dispatch intervals from the results.
4. **Backup and restore.** Daily `pg_dump` (custom format) plus point-in-time recovery where the host supports it (Neon does; the Compose profile uses WAL archiving or documents the gap), and an object-storage inventory. **Restore into a clean environment, run the smoke suite, record the time and the data age (RTO and RPO)**. Repeat each quarter.
5. **Rollback.** Deploy a version with a migration, roll back the image only, and confirm the app still works because migrations are expand-only (`../Agent.md` §9). Record the steps and timing.
6. **Failure injection:** database unavailable (readiness fails, requests fail cleanly, no crash loop), storage unavailable (uploads paused, exports fail with a clear state), AI provider down (model fallback, then plain errors), event consumer failing (dead letters, alert fires).

---

## 8. CI and supply chain

`ci.yml` gains, in this order: install with a frozen lockfile and a **lockfile verification** (no drift), `pnpm audit` for high and critical advisories (a documented allow-list with expiry dates), **secret scan** (gitleaks, blocking), lint, typecheck, unit tests, integration tests, build, `pnpm check:bundle` (no secrets in the client bundle), **container build and image scan** (Trivy, blocking on high and critical with fixes available), **SBOM generation** (CycloneDX, stored as a release artefact), e2e on the built stack, and the push of the image on main. Dependabot or equivalent opens update PRs weekly. The canvas bundle check (the drawing library loads on demand only) and the collab build are steps in the same workflow.

---

## 9. Security hardening for V3

Tested, not just configured (technical spec §14):

- **CSRF:** Server Actions rely on Next's origin checks; Route Handlers that change state require same-origin and a custom header or are authenticated by bearer where non-browser (jobs tick, metrics).
- **Rate limiting** on sign-in, invitations, comments, exports, agent runs, WebSocket token requests and the internal endpoints; failed attempts are counted per address and per account.
- **Secret rotation:** `COLLAB_TOKEN_SECRET`, `COLLAB_INTERNAL_SECRET`, `JOBS_TICK_SECRET`, `METRICS_TOKEN` and session secrets support two values at once (current and previous) so rotation needs no downtime; the runbook has the steps.
- **OAuth** state and PKCE where the provider supports it (Better Auth defaults, verified in a test).
- **Abuse limits:** storage and count quotas per person (canvases 100, templates 50, memories 100, automations 20, comments per minute), request body caps, and WebSocket caps from feature 05.
- **Security headers and CSP** reviewed for the new surfaces (WebSocket `connect-src`, Excalidraw assets from our own origin).
- **Tenant isolation tests:** the ACL matrix from feature 04, plus a generic test that every table with `user_id` is only read through owner-scoped queries (a static check over the query layer), and a cross-person probe over every Route Handler.
- **Audit logging** for sensitive actions already defined in features 04, 08, 09 and 12; this feature checks they exist and contain no content.

---

## 10. Cost accounting

- `ai_usage` already records feature, model, status and timing per call. This feature adds token counts where the provider returns them, an **estimated cost** from a small price table kept in `src/lib/ai/pricing.ts` (updated by hand, clearly dated), and aggregation by person and by feature (diagram generation, agent runs, memory suggestions, assistant, writing help).
- The operator page shows cost per feature per day and the top few accounts by usage as **counts and money only**, with no content.
- Per-person guardrails: the existing per-minute and per-day limits, the agent daily limit (feature 09), and a monthly soft budget setting (`AI_MONTHLY_BUDGET_PER_USER`, optional) that turns heavy AI features off for the rest of the month with a plain message.
- Infrastructure cost (compute, database, storage, bandwidth, observability) is tracked in `docs/costs.md` by hand against the provider invoices, since there is no billing API in the free tiers.

---

## 11. Tests

- **Unit:** correlation id propagation through async boundaries; log shape; metric label allow-list; price table and cost estimate; `ADMIN_EMAILS` parsing; secret rotation (current and previous accepted).
- **Integration:** `/api/health/ready` reports each dependency down correctly; the operator page returns `NOT_FOUND` for non-admins and signed-out visitors and returns no content fields (a test over the response); metrics endpoint refuses without its token; the **log-leak test** (marker strings in every kind of content never appear in captured logs, errors, metrics or traces); the static check for owner-scoped queries.
- **Drills** are scripts with pass/fail output run in staging: load, reconnect, queue, restore, rollback and failure injection, each recorded in the runbook with date and result.
- **E2E:** a smoke run against the deployed staging stack: sign in, create items, share and edit live, comment, run an automation, run an agent with the mock provider, export, with the correlation id of one request found in the logs.

---

## 12. Definition of done

- [ ] ADR 0024 written before building: OpenTelemetry and Prometheus-format metrics, no hosted observability dependency, the topology and scaling stance, staging isolation
- [ ] Every request, job, run, event and collaboration session has a correlation id that shows in logs; no private content appears in logs, metrics or traces (tested)
- [ ] Readiness, metrics, traces and the alert rules exist, with runbook links
- [ ] The operator page works for allowed accounts only and shows no content
- [ ] Staging is isolated and deploys every merge; production promotes the same image; rollback is rehearsed
- [ ] Load tests, WebSocket reconnect, queue and failure-injection drills are recorded with results
- [ ] A backup restore into a clean environment has been done and timed (RTO and RPO recorded)
- [ ] CI blocks on audit, secret scan, image scan and lockfile drift, and produces an SBOM
- [ ] AI cost is recorded per feature and person, with budget guardrails
- [ ] `docs/infrastructure.md`, `docs/runbook.md`, `docs/costs.md` and `docs/observability/` are current
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/scale-reliability-and-observability_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 13. Out of scope (this feature)

- Kubernetes, service meshes, multi-region or multi-cloud deployment; managed secret stores before scale justifies them.
- A hosted observability product, log shipping, or paging integration (the rules and dashboards are files).
- Splitting the monolith into services beyond web, worker and collaboration.
- Per-organisation admin, billing, plans or usage-based invoicing.
- Table partitioning, read replicas, a cache layer (until the metrics show a need).
- Two-factor authentication, passkeys and risk-based sign-in (separate product work).
