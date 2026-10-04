# Deploying Dayboard for free (feature 06 options)

Date: 2026-10-04. Free-tier terms change often. Everything marked **(verify)** was not confirmed
against the provider's own page when this was written; check it before you rely on it.

## Question

Feature 06 (`specs/v1/features/06-production-devops.md`) describes a paid-style setup: one Linux VM,
Docker Compose, Caddy, GitHub Actions deploys, backups. Can the app go live for **$0**, and what
are the steps?

## Short answer

Yes, for one person or a small invite-only group. There are three workable routes:

|                     | Route                                                                 | Card needed                                              | Closest to the spec                     | Effort | Main catch                                                            |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ------ | --------------------------------------------------------------------- |
| **A**               | Oracle Cloud Always Free VM + the spec's Compose/Caddy/CD             | Yes                                                      | Most                                    | High   | Oracle halved the free ARM VM in June 2026 and reclaims idle ones     |
| **B** (recommended) | **Google Cloud Run** (your existing Docker image) + **Neon** Postgres | Yes (billing must be on; stays $0 inside the free quota) | Medium: same image, same migration step | Medium | First request after idle is slow (two cold starts)                    |
| **C**               | **Vercel Hobby** + **Neon**                                           | No                                                       | Least                                   | Low    | Non-commercial only; needs one small code change; Docker image unused |

Whichever you pick, two things are the same:

- **Email** is mandatory in production (the app refuses to start without `RESEND_API_KEY`), and
  Resend's free test sender can only send to **your own address**. So either you are the only
  email/password user, or you use Google/GitHub sign-in for everyone else, or you pay for a domain
  (about $10 a year). See "Email" below.
- **AI** is free with Google's Gemini key (`AI_PROVIDER=gemini`).

**My recommendation:** Route B. It keeps the Dockerfile and `migrate.mjs` you already built (the
spec's "immutable image + migration step + health check + rollback"), and removes the part that
costs time and risk when free: babysitting a VM. Use C if you will not give a card to anyone. Use A
only if learning VM/Compose/Caddy operations is itself the goal.

## What exists, and what feature 06 still needs

Already in the repo:

- `Dockerfile` (multi-stage, standalone output, non-root, `HEALTHCHECK`, no secrets), `.dockerignore`
- `docker-compose.yml` (local `db`, plus a `full` profile that runs the production image)
- `GET /api/health` (DB check with a 2 s timeout, `version` from `APP_VERSION`)
- `scripts/migrate.ts`, bundled into the image as `migrate.mjs` (`pnpm build:migrate`)
- `scripts/check-client-bundle.mjs` (secret leak check) and env validation in `src/lib/env-schema.ts`
- Request ids and JSON logs; per-user AI limits; auth rate limits stored in the database

Not there yet (all of feature 06's remaining files):

- `docker-compose.prod.yml`, `Caddyfile`
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- `scripts/deploy.sh`, `rollback.sh`, `backup.sh`, `restore.sh`, `healthcheck.sh`
- `docs/deployment.md`, `docs/runbook.md`
- A least-privilege database role (the spec's §9 asks for one)

Which of those you need depends on the route: A needs all of them; B and C need CI (and a small
deploy workflow) and replace the Compose/Caddy/scripts with the platform's own features.

## Facts about this app that decide the options

These come from reading the code, not from the specs.

1. **Production requires https and email.** `src/lib/env-schema.ts` fails startup in production
   without `RESEND_API_KEY`, `EMAIL_FROM`, and an `https://` `BETTER_AUTH_URL`.
2. **Email verification is enforced** whenever Resend is configured, and is also used for password
   reset and magic links.
3. **Database:** `postgres.js` with a pool of 10 per process (`src/db/client.ts`), plain
   `postgres://` URL. Any managed Postgres works. Behind a connection pooler (PgBouncer in
   transaction mode, such as Neon's `-pooler` host) prepared statements must be turned off
   (`postgres(url, { prepare: false })`); today they are not.
4. **`NEXT_PUBLIC_APP_URL` is baked in at build time** (`layout.tsx` metadata, `robots.ts`,
   `sitemap.ts`). The Dockerfile has no `ARG` for it, so an image built today carries
   `http://localhost:3000` in OG/robots/sitemap URLs. Add `ARG NEXT_PUBLIC_APP_URL` to the builder
   stage before the first real build. Auth itself uses the runtime `BETTER_AUTH_URL` and is not
   affected.
5. **Streaming AI responses** (NDJSON) need a platform that allows responses to run for tens of
   seconds. Cloud Run, a VM and Vercel all do.
6. **Auth rate limits use the database** (`rateLimit.storage: "database"`), so they work across
   several instances.
7. **Migrations must stay backward compatible** with the previous release (spec §11), because every
   route below rolls back by redeploying the old image without un-migrating.

## Email on a $0 budget

- Resend free: 3,000 emails a month, 100 a day, up to 3 verified domains
  ([Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing),
  [free tier post](https://resend.com/blog/new-free-tier)).
- Without a verified domain you may send only to your own address. Resend's rule: "You can only
  send testing emails to your own email address"
  ([Resend docs](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)).

So, at $0:

| Who signs up                                                                                   | Works?                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| You, with email + password (`EMAIL_FROM="Dayboard <onboarding@resend.dev>"`, your own address) | Yes                                                    |
| Anyone, with Google or GitHub                                                                  | Yes, no email is needed (the provider has verified it) |
| Someone else, with email + password, magic link or password reset                              | No, until you verify a domain                          |

If you want others to use email sign-in, the honest cost is a domain (about $10 a year) added to
Resend with its SPF/DKIM records. A single-sender service (for example Brevo) might avoid the
domain, but the app would need a new `EmailSender` implementation and an ADR if it adds a package
(`CLAUDE.md` §2). I did not verify that route **(verify)**.

## Options considered

Prices and limits as found on 2026-10-04.

| Option                                | Free allowance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Oracle Cloud Always Free (ARM VM)** | Cut in June 2026 from 4 OCPU / 24 GB to **2 OCPU / 12 GB**; instances over the new limit after 2026-08-18 are terminated; an A1 instance with p95 CPU, network and memory all under 20% for 7 days can be reclaimed ([Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/), [Terminal Bytes](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/), [Space-Node](https://space-node.net/blog/oracle-cloud-always-free-limits-2026)). Card needed. Capacity in popular regions is often "out of host capacity". | Fits the spec best. Fits the app (2 OCPU / 12 GB is plenty). Risky for a lightly used app because it can look idle. |
| **Google Cloud Run**                  | Always free per month: 2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds, request-based billing, minimum instances must stay 0 ([Cloud Run pricing](https://cloud.google.com/run/pricing), [guide](https://lalatenduswain.medium.com/building-cloud-native-apps-for-free-in-2026-the-complete-developers-guide-to-google-cloud-s-3d93b77c4adb)). Billing account (card) required.                                                                                                                                                                  | Best fit for a container. A personal app uses a tiny fraction of this.                                              |
| **Neon (Postgres)**                   | Free plan: 1 GB per project, 100 compute-hours per project per month, scales to zero after 5 minutes (cannot be disabled), data is never deleted for inactivity ([Neon FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)). Card requirement not stated on that page **(verify)**.                                                                                                                                                                                                                                                                        | Best free database for this app.                                                                                    |
| **Supabase (Postgres)**               | 500 MB, free projects pause after 7 days of low activity, 2 free projects ([overview](https://uibakery.io/blog/supabase-pricing)).                                                                                                                                                                                                                                                                                                                                                                                                                             | Works, but the pause is a trap for a rarely used app. Neon is simpler.                                              |
| **Vercel Hobby**                      | Free, personal and non-commercial use only; about 1M function invocations and 4 CPU-hours of function time a month; function duration up to 300 s ([Vercel limits](https://vercel.com/docs/limits), [summary](https://zplatform.ai/guides/is-vercel-free/)). No card.                                                                                                                                                                                                                                                                                          | Good for a personal app. Not for anything that earns money.                                                         |
| **Render free**                       | Web service sleeps after 15 minutes (about a minute to wake); **free Postgres expires after 30 days** ([Render docs](https://render.com/docs/free)).                                                                                                                                                                                                                                                                                                                                                                                                           | Not suitable: the database disappears.                                                                              |
| **Fly.io**                            | No free allowance for new accounts; 2 hours or 7 days of trial, then about $2.19 per month per small machine ([Fly pricing](https://fly.io/docs/about/pricing/)).                                                                                                                                                                                                                                                                                                                                                                                              | Not free.                                                                                                           |

"Nothing keeps a continuously running backend awake for $0" is a fair summary of the market
([livemy.app](https://livemy.app/blog/free-hosting-that-doesnt-sleep)). Routes B and C accept
cold starts instead; route A is the only always-on one, with the reclaim risk above.

---

## Route B (recommended): Cloud Run + Neon + Resend + Gemini

All commands assume macOS/Linux with Docker and the
[`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed. Replace `PROJECT`, `REGION`
and `TAG`. Pick a Cloud Run region close to your Neon region (for example `us-east1` or `us-central1`
next to a US Neon region).

### B0. Repo changes to make first

1. Add `ARG NEXT_PUBLIC_APP_URL` and `ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL` to the
   `builder` stage of the `Dockerfile` (fact 4).
2. Optional but wise: add `.github/workflows/ci.yml` from feature 06 §7 (lint, typecheck, test,
   build, secret check, E2E against a Postgres service). GitHub Actions is free for public repos;
   private-repo minutes are limited **(verify)**.

### B1. Accounts (no money spent)

- **Neon**: create a project and a database named `dayboard`. Copy two connection strings: the
  **direct** one and the **pooled** one (host contains `-pooler`).
- **Resend**: create an API key. Use `EMAIL_FROM="Dayboard <onboarding@resend.dev>"` for now.
- **Google AI Studio**: create a key at `https://aistudio.google.com/apikey`.
- **Google Cloud**: create a project, attach a billing account, set a **budget alert** of $1 (it
  warns, it does not cap).
- Generate the auth secret: `openssl rand -base64 32`.

### B2. Prove the database works from your laptop

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST/dayboard?sslmode=require'   # the DIRECT string
pnpm db:migrate
```

Use the direct string for the app and the migration job. It avoids the prepared-statement problem
(fact 3): 10 connections per instance times at most 2 instances is within a small Neon compute's
limit **(verify the current limit for your compute size)**. If you later switch to the pooled string,
set `prepare: false` in `src/db/client.ts` first.

### B3. Google Cloud setup (once)

```bash
gcloud config set project PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create dayboard --repository-format=docker --location=REGION
gcloud auth configure-docker REGION-docker.pkg.dev
```

Store the secrets (Secret Manager has a small free allowance **(verify)**; plain `--set-env-vars`
also works but shows values in the console):

```bash
printf '%s' "$DATABASE_URL"        | gcloud secrets create database-url --data-file=-
printf '%s' "$BETTER_AUTH_SECRET"  | gcloud secrets create better-auth-secret --data-file=-
printf '%s' "$RESEND_API_KEY"      | gcloud secrets create resend-api-key --data-file=-
printf '%s' "$AI_API_KEY"          | gcloud secrets create ai-api-key --data-file=-
```

Let the Cloud Run runtime service account read them
(`roles/secretmanager.secretAccessor`, shown in the console under IAM).

### B4. Build and push an immutable image

Cloud Run runs `linux/amd64`, so on an Apple-silicon Mac build for that platform:

```bash
TAG=sha-$(git rev-parse --short=7 HEAD)
IMAGE=REGION-docker.pkg.dev/PROJECT/dayboard/web:$TAG
docker buildx build --platform linux/amd64 \
  --build-arg APP_VERSION=$TAG \
  --build-arg NEXT_PUBLIC_APP_URL=https://YOUR-FINAL-URL \
  -t $IMAGE --push .
```

`YOUR-FINAL-URL` is not known until the first deploy (B6). The first image can carry a placeholder;
rebuild once with the real URL before sharing the site (it only affects OG, robots and sitemap
links).

### B5. Run migrations as their own step

The image already contains `migrate.mjs`. Run it as a Cloud Run **Job** and abort the release if it
fails (spec §8):

```bash
gcloud run jobs create dayboard-migrate --region REGION --image $IMAGE \
  --command node --args migrate.mjs \
  --set-secrets DATABASE_URL=database-url:latest
gcloud run jobs execute dayboard-migrate --region REGION --wait
```

For later releases: `gcloud run jobs update dayboard-migrate --image $IMAGE ...` then execute.

### B6. Deploy the service

```bash
gcloud run deploy dayboard --region REGION --image $IMAGE \
  --allow-unauthenticated --port 3000 \
  --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 \
  --set-secrets DATABASE_URL=database-url:latest,BETTER_AUTH_SECRET=better-auth-secret:latest,RESEND_API_KEY=resend-api-key:latest,AI_API_KEY=ai-api-key:latest \
  --set-env-vars BETTER_AUTH_URL=https://PLACEHOLDER,NEXT_PUBLIC_APP_URL=https://PLACEHOLDER,EMAIL_FROM='Dayboard <onboarding@resend.dev>',AI_PROVIDER=gemini,AI_MODEL=gemini-3.5-flash,AI_MODEL_FAST=gemini-3.5-flash-lite
```

Read the real URL, then set it and redeploy:

```bash
URL=$(gcloud run services describe dayboard --region REGION --format='value(status.url)')
gcloud run services update dayboard --region REGION \
  --set-env-vars BETTER_AUTH_URL=$URL,NEXT_PUBLIC_APP_URL=$URL
curl -s $URL/api/health        # {"status":"ok","db":"ok","version":"sha-..."}
```

The first request after a quiet period waits for two cold starts (Cloud Run, then Neon waking). Do
not "fix" this with a keep-alive ping or `--min-instances 1`: that is what leaves the free quota.

### B7. Sign-in providers

- **Google**: OAuth client with authorized origin `$URL` and redirect
  `$URL/api/auth/callback/google`. Publish the consent screen, or add yourself as a test user.
  Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (as secrets) with `gcloud run services update`.
- **GitHub**: OAuth app with callback `$URL/api/auth/callback/github`; set both values.
- Both IDs and secrets must be set together or the app refuses to start (`pair()` in the env
  schema).

### B8. Verify (this is feature 06's "definition of done" for route B)

- [ ] `/api/health` returns `ok` and the version matches the image tag
- [ ] Sign up with email: the verification mail arrives (your own address), link works, you land
      on onboarding
- [ ] Google and GitHub sign-in work over https
- [ ] Create a task and a note, reload, they persist; AI buttons appear and Generate with AI works
- [ ] `pnpm check:bundle` passes on the build; `docker history $IMAGE` shows no secrets
- [ ] Neon's connection string is not reachable by anything you did not intend (it is a public
      endpoint with a password: use a strong one and `sslmode=require`)

### B9. Releasing and rolling back

```bash
# release: build a new immutable tag, migrate, then switch traffic
gcloud run jobs update dayboard-migrate --region REGION --image $NEW_IMAGE
gcloud run jobs execute dayboard-migrate --region REGION --wait      # stop here if it fails
gcloud run deploy dayboard --region REGION --image $NEW_IMAGE

# rollback: send traffic to the previous revision (no migration is undone)
gcloud run revisions list --service dayboard --region REGION
gcloud run services update-traffic dayboard --region REGION --to-revisions=PREVIOUS_REVISION=100
```

Rollback only works because migrations are expand/contract (fact 7). Rehearse it once and write
the timing in `docs/runbook.md`, as feature 06 asks.

### B10. Automating it (optional, later)

A `deploy.yml` on pushes to `main` that runs CI, builds with Buildx, pushes to Artifact Registry,
executes the migration job, deploys, polls `/api/health`, and runs the rollback command if the
check fails. Authenticate GitHub to Google with **Workload Identity Federation**
(`google-github-actions/auth`), not a downloaded JSON key, so no long-lived key sits in GitHub.

### B11. Backups

The spec's `backup.sh` (`pg_dump` on the VM) does not apply. Options at $0:

- Neon keeps data and offers restore from history; the free plan's history window is short
  **(verify)**.
- A scheduled GitHub Actions workflow running `pg_dump -Fc "$DATABASE_URL"` (the Neon direct URL as a
  repository secret) and uploading the file as an artifact. Artifacts are time-limited; for a
  private repo that is a copy on someone else's servers, so encrypt it.
- Run `pg_dump` by hand before every release that contains a migration.

### B12. Cost guardrails

- Budget alert at $1, and look at the billing page for the first two weeks.
- Keep `--min-instances 0` and `--max-instances 2`.
- The app's own limits (10 AI actions a minute, 100 a day per person) already cap Gemini use; keep
  the free-tier data notice in Settings.
- Cloud Run egress is free for the first gigabytes **(verify)**; a personal app is far below it.

---

## Route C: Vercel Hobby + Neon (no card)

1. Push the repo to GitHub, import it in Vercel. Framework: Next.js. No Dockerfile is used.
2. Create the Neon project as in B1, and in Vercel set the same environment variables as B6
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` set to your
   `*.vercel.app` URL, `RESEND_API_KEY`, `EMAIL_FROM`, `AI_PROVIDER=gemini`, `AI_API_KEY`, models).
3. **Code change:** every serverless invocation can open its own connections. Use Neon's **pooled**
   URL and set `prepare: false` (and a small `max`, such as 1 to 3) in `src/db/client.ts`. Keep the
   direct URL for migrations.
4. Run migrations from your laptop or a GitHub Action with the direct URL
   (`pnpm db:migrate`) before each deploy that has a new migration. Vercel has no migration step
   of its own.
5. Do the same OAuth and email steps as B7. Rollback is "Promote" on an older deployment in the
   Vercel dashboard.
6. Limits to remember: personal and non-commercial use only; about 1M function invocations a
   month; the spec's Docker/Compose/Caddy/backup items are not exercised by this route.

## Route A: Oracle Always Free VM (follows the spec exactly)

Use this if the goal is to practise the spec's operations.

1. Create the account (card for verification). Create **one** Ampere A1 instance at or under
   **2 OCPU / 12 GB** (the June 2026 limit) with Ubuntu LTS. If the region says "out of host
   capacity", retry later or pick another availability domain.
2. Open ports 22, 80 and 443 in the VCN security list and in `ufw`; nothing else.
3. Follow spec §12: Docker Engine + Compose plugin, SSH keys only, `unattended-upgrades`, a deploy
   user, `/opt/dayboard`.
4. Get a hostname with https. Caddy needs a name that points at the VM. A free dynamic-DNS
   hostname works for Caddy's certificates but not for Resend's domain records
   **(verify)**; a $10 domain solves both.
5. Build the missing feature 06 files (list above): `docker-compose.prod.yml`, `Caddyfile`,
   scripts, workflows, `docs/deployment.md`, `docs/runbook.md`. Images build as arm64 here
   (`--platform linux/arm64`), so build in GitHub Actions with Buildx for the VM's architecture.
6. Do the spec's rehearsals (M7 rollback, M8 restore) and write the timings down.
7. Watch the reclaim rule: if the VM stays under 20% on CPU, network and memory for 7 days,
   Oracle may reclaim it. Back up with `backup.sh` to somewhere that is **not** the VM
   (the spec admits same-VM backups are weak).

Also consider the E2 micro (x86, 1 GB) Always Free shape: too small to build the image on, and
tight for Next.js plus Postgres, but enough to run a pre-built image with an external database
**(verify it is still offered)**.

## Decision guide

| If you want...                                                                  | Pick                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The easiest $0 path that keeps the Docker image and migration step              | **B**                                                  |
| No credit card anywhere, personal use only                                      | **C**                                                  |
| To learn VM, Compose, Caddy, backups and rollback scripts as feature 06 intends | **A** (and accept the reclaim risk)                    |
| Other people to use email/password sign-in                                      | any route, plus a domain for Resend (about $10 a year) |

## Order of work, whichever route

1. Add `ARG NEXT_PUBLIC_APP_URL` to the Dockerfile (all container routes).
2. Add CI (`ci.yml`) and make it required on `main`.
3. Provision the database and the three keys (Resend, Gemini, auth secret).
4. First deploy, URL, OAuth apps, verification checklist.
5. Rehearse rollback; write `docs/runbook.md` and `docs/deployment.md`.
6. Add the deploy workflow last.
7. Write `agent_docs/production-devops_v1.md` and add its line to `agent_docs/README.md`; if you
   depart from the spec (for example, Cloud Run instead of a VM), record an ADR in
   `docs/decisions/` first (`CLAUDE.md` §3).

## Not verified

Docker and the production image have never been run on this machine (Docker is not installed
here), so the image has not been exercised as a container. The commands above are written from the
providers' documented behavior and the app's code, not run. Items marked **(verify)** and the exact
`gcloud` flags should be checked against the current docs on the day you deploy.

## Sources

- [Oracle: free tier cut](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/), [details](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026/), [limits](https://space-node.net/blog/oracle-cloud-always-free-limits-2026)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Neon free plan](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Supabase free tier](https://uibakery.io/blog/supabase-pricing)
- [Vercel limits](https://vercel.com/docs/limits)
- [Render free](https://render.com/docs/free)
- [Fly.io pricing](https://fly.io/docs/about/pricing/)
- [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [test-domain rule](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
