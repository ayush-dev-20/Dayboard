# Agent.md — V3 Coding Agent Instructions

## 1. Read first

Read:

- `01-product-spec.md`
- `02-technical-spec.md`
- `03-ui-ux-spec.md`
- `04-devops-deployment-spec.md`
- `05-project-plan.md`

Then inspect the existing V1/V2 repository architecture before changing it.

## 2. V3 principles

- Extend the modular monolith before extracting services.
- Treat authorization as a domain invariant.
- Treat AI actions as auditable tool calls.
- Make integrations replaceable.
- Make automation idempotent.
- Preserve a Docker-first developer workflow.

## 3. Hard architectural boundaries

Do not spread collaboration state, integration SDK calls, or workflow execution logic through ordinary UI/business modules.

Use clear modules such as:

```text
modules/
  auth/
  tasks/
  notes/
  projects/
  search/
  ai/
  collaboration/
  comments/
  automations/
  integrations/
  notifications/
  billing/
```

## 4. Permission rules

Server-side authorization is mandatory.

Never rely on hiding a button to enforce access.

Every server command must resolve:

`actor -> workspace -> resource -> permission -> action`

Write permission tests before shipping new sharing capabilities.

## 5. Collaboration rules

Do not attempt to make the entire application real-time.

Limit real-time state to collaboration-enabled note documents and presence.

Ensure reconnect and offline transitions do not duplicate document updates.

## 6. Automation rules

Every external side effect should be:

- explicit
- logged
- retryable
- idempotent where possible

Do not create an automation engine with dozens of triggers/actions in the first iteration.

## 7. AI agent rules

Agents operate only through registered tools.

Each tool must declare:

- scope
- risk level
- approval policy
- audit event

Never grant an agent unrestricted database access.

Never let a generated string become an external side effect without passing through a validated tool.

## 8. Integration rules

Provider SDKs belong in integration adapters.

Core domain code should depend on interfaces, not vendor SDKs.

Store secrets securely and rotate credentials without code changes.

## 9. Data and migration rules

Avoid breaking migrations.

For migrations involving shared/collaborative data:

1. add new structure,
2. backfill,
3. switch reads,
4. switch writes,
5. remove legacy structure only after verification.

## 10. Observability rules

Use correlation ids for:

- HTTP requests
- automation runs
- AI agent runs
- integration webhook deliveries
- background jobs
- collaboration sessions

Never log private document contents by default.

## 11. Testing rules

Minimum automated coverage for V3 additions:

- ACL/authorization matrix
- collaboration reconnect
- automation idempotency
- approval bypass prevention
- webhook signature/replay protection
- integration token refresh
- AI tool authorization
- memory deletion
- account deletion/export

Critical user journeys require Playwright coverage.

## 12. Change discipline

For any architecture change, create a concise ADR in `docs/decisions/` explaining:

- context
- decision
- alternatives
- consequences

Do not rewrite working V2 systems merely for stylistic preference.
