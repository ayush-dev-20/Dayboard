# V3 DevOps & Deployment Specification — Scale Without Losing Simplicity

## 1. Goal

V3 should demonstrate how a single-container deployment evolves into a production topology that can scale selective workloads without abandoning Docker.

## 2. Reference topology

```text
                   Internet
                      |
                 CDN / WAF
                      |
                   Caddy/LB
                      |
          +-----------+-----------+
          |                       |
      Next.js Web           Real-time service
          |                       |
          +-----------+-----------+
                      |
               PostgreSQL
                      |
             +--------+--------+
             |                 |
          Workers          Event/Queue
             |
      Object Storage / R2
```

The exact managed-vs-self-hosted components can vary, but boundaries must remain explicit.

## 3. Environment model

Maintain:

- local
- preview/staging
- production

Preview environments should use isolated databases/storage credentials.

## 4. Infrastructure as code

Introduce an infrastructure-as-code layer only when deployment components become numerous enough to justify it.

Recommended candidate: Terraform or OpenTofu.

Start with documented modules for:

- compute
- network/firewall
- storage
- database
- DNS
- secrets

Do not manage every local Docker development detail through IaC.

## 5. Container strategy

Build immutable images.

Tag using:

- git SHA
- semantic release version where applicable

Do not rely on mutable `latest` for rollback.

## 6. Deployment strategy

Use staged deployment:

1. build
2. security/scanning checks
3. push images
4. migrate
5. deploy web
6. deploy worker
7. deploy real-time service
8. smoke test
9. monitor
10. promote

For higher availability, introduce rolling or blue/green deployment only when required.

## 7. Database operations

V3 should include:

- automated backups
- point-in-time recovery where supported
- restore drills
- migration compatibility checks
- safe index rollout practices

## 8. Secrets

Move production secrets toward a managed secret store when scale justifies it.

The application should consume secrets through environment/runtime injection rather than committing them.

## 9. Security supply chain

CI should include:

- dependency audit
- container image scan
- secret scanning
- lockfile verification
- SBOM generation where practical

## 10. Observability

Use structured application logs, metrics, traces, and alerting.

Minimum production alerts:

- high error rate
- database saturation
- queue backlog
- worker dead/heartbeat missing
- collaboration service unavailable
- webhook delivery failure spike
- storage failure spike

## 11. Rollback

Every deployment should have:

- previous image references
- backward-compatible migration strategy
- rollback runbook
- incident notes

Avoid destructive migrations that make immediate rollback impossible.

## 12. Cost control

Keep infrastructure intentionally boring and measurable.

Track:

- compute
- database
- object storage
- AI provider usage
- bandwidth
- queue usage
- observability spend

AI cost should have per-user and per-feature accounting.

## 13. Production readiness review

Before enabling collaboration and automations broadly:

- load test critical endpoints
- test websocket reconnects
- test queue retries
- test webhook replay protection
- test permission boundaries
- perform database restore drill
