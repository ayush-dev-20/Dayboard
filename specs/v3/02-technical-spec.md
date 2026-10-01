# V3 Technical Specification — Collaboration, Automation, Integrations, and Scale

## 1. Architecture direction

Keep the V2 modular monolith as the domain core.

Introduce dedicated infrastructure only for workloads that benefit from isolation:

- real-time collaboration service
- background job workers
- optional event bus/queue

Do not split ordinary CRUD into microservices.

## 2. Collaboration architecture

Recommended approach for rich-text collaboration:

- Tiptap collaboration
- Yjs-compatible document model
- WebSocket-based collaboration transport
- persistent document snapshots in PostgreSQL/object storage

Collaboration state should be treated separately from ordinary CRUD rows.

Flow:

```text
Editor
  ↓
Collaboration provider
  ↓
Shared document state
  ↓
Persistence / snapshots
  ↓
PostgreSQL + Object Storage
```

Only selected note documents use real-time collaboration.

## 3. Permissions model

Introduce resource-level ACLs:

- workspace membership
- project membership
- document share
- comment permissions

Authorization must be enforced server-side and independently of UI visibility.

## 4. Event model

Introduce domain events:

```ts
task.completed
task.created
note.updated
project.shared
comment.created
calendar.connected
integration.event.received
automation.triggered
```

Events should be append-only records with payload schemas.

Use an outbox pattern so database mutations and emitted events remain consistent.

## 5. Automation architecture

Create a workflow model with:

- workflow
- trigger
- condition
- action
- run
- run step
- execution log

Actions must be idempotent where possible.

Every workflow run should have:

- correlation id
- start/end time
- outcome
- step results
- retry count
- approval requests

## 6. Integration platform

Create an integration framework:

```ts
interface IntegrationProvider {
  providerKey: string
  authorize(): Promise<void>
  handleWebhook(request: Request): Promise<void>
  listCapabilities(): Capability[]
}
```

Store credentials in an encrypted secret store or encrypted database fields with a dedicated key-management strategy.

## 7. Webhooks

Expose signed webhooks for user-defined integrations.

Requirements:

- per-endpoint secret
- HMAC signature
- timestamp/replay protection
- retry policy
- delivery logs
- endpoint disablement after repeated failure

## 8. AI agent runtime

AI agents should use tools through a permissioned tool registry.

Example tools:

- searchWorkspace
- getCalendar
- createTask
- updateTask
- createNote
- createComment
- sendWebhook
- createExternalDraft

Every tool definition should include:

- required scope
- mutation risk class
- approval requirement
- audit event

## 9. Approval system

Define action risk classes:

- read-only
- local reversible
- local destructive
- external reversible
- external side effect

Default policy:

- read-only: automatic
- local reversible: user setting may permit automatic
- destructive/external side effect: explicit approval

## 10. Memory architecture

Separate user-controlled memory from raw workspace retrieval.

Suggested tables:

- memory_items
- memory_sources
- memory_preferences

Every memory item should record:

- provenance
- confidence/quality metadata
- createdAt
- updatedAt
- user approval state

Allow deletion and source inspection.

## 11. Search architecture

V3 search becomes a unified retrieval layer over:

- tasks
- notes
- comments
- calendar events
- files/metadata
- memories
- integration objects where indexed

Keep ACL filtering before result presentation.

## 12. Real-time infrastructure

For moderate scale, a single collaboration service is enough.

If scaling horizontally:

- use a shared pub/sub layer
- use sticky-session strategy only where required
- persist document snapshots
- monitor active connections

Do not put the entire app behind a WebSocket architecture.

## 13. Database evolution

Use PostgreSQL for transactional state.

Add indexes based on real query plans.

Introduce partitioning only for high-volume append-only tables such as event/audit records when metrics demonstrate the need.

## 14. Observability

Use structured logs and traces.

Track:

- collaboration connection counts
- document update latency
- workflow run success/failure
- webhook delivery latency
- AI tool calls
- approval wait times
- integration token refresh failures
- database latency
- queue latency

Create product-level health dashboards separately from infrastructure metrics.

## 15. Security

V3 expands the attack surface significantly.

Required:

- RBAC/ACL tests
- webhook signature verification
- CSRF protection
- OAuth state/PKCE where applicable
- secret rotation
- rate limiting
- abuse detection
- audit logs for sensitive actions
- secure session/device management
- tenant isolation tests

## 16. Data export and deletion

Users must be able to:

- export their workspace
- disconnect integrations
- delete selected data
- request full account deletion

The deletion process must define what happens to shared content and audit records.
