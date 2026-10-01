# V2 DevOps & Deployment Specification — PWA + Worker + Storage

## 1. Deployment goal

Keep the V1 Docker-first deployment model but introduce a background worker and object storage.

Production components:

- Caddy
- Next.js web container
- Worker container
- PostgreSQL container or managed PostgreSQL
- object storage such as Cloudflare R2

## 2. Compose topology

```text
             Internet
                 |
               Caddy
              /     \
             /       \
        Next.js      HTTPS
             |
      +------+------+
      |             |
 PostgreSQL       Worker
      |             |
      +------+------+
             |
        Object Storage
```

For small deployments, Next.js and worker can live on one VM.

## 3. Docker requirements

Continue using:

- multi-stage Dockerfiles
- non-root runtime user
- minimal production image
- healthcheck
- pinned lockfile
- `.dockerignore`
- build-time vs runtime environment separation

The web image should continue using Next.js standalone output where compatible with the chosen configuration.

## 4. Worker image

Use the same repository and dependency graph where possible, but run a different command.

Example responsibilities:

`pnpm worker`

The worker should support graceful shutdown and retryable jobs.

## 5. Storage configuration

Use environment variables for object storage endpoint and credentials.

Never embed bucket secrets in the image.

Keep bucket private.

## 6. Database migrations

Deployment sequence:

1. Pull immutable image.
2. Verify environment configuration.
3. Run database migrations as a one-off release job/container.
4. Start/replace web container.
5. Start/replace worker.
6. Wait for health checks.
7. Run smoke test.
8. Mark deployment successful.

Do not run migrations from every app replica automatically.

## 7. CI pipeline

Pull requests:

- install dependencies
- lint
- typecheck
- unit tests
- build
- Playwright critical smoke tests
- Docker build validation

Main branch:

- build immutable image tag using commit SHA
- push to registry

## 8. CD pipeline

Production deployment should:

- deploy a specific image SHA
- keep previous image available
- run migration step
- perform health checks
- execute a smoke test
- support rollback to previous image

Do not deploy `latest` as the only production reference.

## 9. Monitoring

Add:

- `/api/health`
- `/api/ready`
- sync metrics
- worker heartbeat
- job queue depth
- storage error counts

A production deployment should fail clearly if PostgreSQL or critical configuration is unavailable.

## 10. Backups

Maintain automated PostgreSQL backups.

Verify restoration periodically in a separate environment.

Backups must not be considered complete until restore has been tested.

## 11. Disaster recovery

Document:

- database restore procedure
- object storage recovery assumptions
- credential rotation
- rollback procedure
- expired OAuth token handling
- worker queue replay behavior

## 12. PWA release safety

The service worker must not unexpectedly trap users on stale application assets.

Version the worker/cache namespace and provide an update UX.

Test:

- first install
- offline launch
- update from old version to new version
- failed asset fetch
- stale cache recovery
