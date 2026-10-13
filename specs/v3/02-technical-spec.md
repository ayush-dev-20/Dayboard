# V3 Technical Specification — Canvas, Collaboration, Automation, and Scale

## 1. Architecture direction

Keep the V2 modular monolith as the domain core.

Introduce dedicated infrastructure only for workloads that benefit from isolation:

- real-time collaboration service
- background job workers
- optional event bus/queue

Do not split ordinary CRUD into microservices.

## 2. Canvas architecture

The first V3 feature ([features/01-canvas-with-ai-diagrams.md](features/01-canvas-with-ai-diagrams.md) holds the full breakdown). A canvas is ordinary CRUD in the monolith: no new service, no real-time transport.

- **Storage:** a `canvases` table (owner, optional project, title, emoji, `scene_json`, a server-built `scene_text` for search, `element_count`, a `version` for optimistic saves, archive and Trash timestamps). The scene is JSON; the drawing library is loaded in the browser only (Excalidraw, MIT, after ADR 0017).
- **Scene whitelist:** `sanitizeScene` accepts only known element types (`rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`, `frame`, `freedraw`), limits size (1,000,000 bytes, 2,000 elements), clamps numbers, allows only safe links and a single `customData` key, and rebuilds the search text on the server. Images, embeds and unknown types are refused.
- **AI contract:** the model returns a small `DiagramSpec` (sections, nodes, edges), checked with Zod and repaired by `normalizeDiagram`; it never returns coordinates, colours, links or drawing data. Routes `POST /api/ai/generate-diagram` and `POST /api/ai/refine-diagram` go through the existing AI gate (limits, usage row, mock provider, versioned prompts, model fallback) and write nothing; a person's confirm click calls `createCanvas` or `saveCanvas`.
- **Task links:** a `task_canvases` join table (task, canvas, owner; cascade on both sides), the same shape as `task_notes`, with link, unlink and search actions on both sides.
- **Layout and scene building** are pure functions that run in the browser (`layoutDiagram`, scene builder), so the server never imports the drawing library and the layout is deterministic and testable.
- **Audit:** applying an AI diagram writes one `audit_log` row (source `CANVAS`, counts only, once per proposal).
- **Permissions:** a canvas is private to its owner and every query and action filters by the session user. Sharing a canvas is not part of this feature; it needs an ADR once the permission model (§4) exists.
- **Not real-time:** collaboration state stays limited to note documents (§3).

## 3. Collaboration architecture

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

## 4. Permissions model

Introduce resource-level ACLs:

- workspace membership
- project membership
- document share
- comment permissions

Authorization must be enforced server-side and independently of UI visibility.

## 5. Event model

Introduce domain events:

```ts
task.completed
task.created
note.updated
project.shared
comment.created
calendar.connected
automation.triggered
```

Events should be append-only records with payload schemas.

Use an outbox pattern so database mutations and emitted events remain consistent.

## 6. Automation architecture

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

## 7. AI agent runtime

AI agents should use tools through a permissioned tool registry.

Example tools:

- searchWorkspace
- getCalendar
- createTask
- updateTask
- createNote
- createComment

Every tool definition should include:

- required scope
- mutation risk class
- approval requirement
- audit event

## 8. Approval system

Define action risk classes:

- read-only
- local reversible
- local destructive

Default policy:

- read-only: automatic
- local reversible: user setting may permit automatic
- destructive: explicit approval

## 9. Memory architecture

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

## 10. Search architecture

V3 search becomes a unified retrieval layer over:

- tasks
- notes
- canvases (box and label text)
- comments
- calendar events
- files/metadata
- memories

Keep ACL filtering before result presentation.

## 11. Real-time infrastructure

For moderate scale, a single collaboration service is enough.

If scaling horizontally:

- use a shared pub/sub layer
- use sticky-session strategy only where required
- persist document snapshots
- monitor active connections

Do not put the entire app behind a WebSocket architecture.

## 12. Database evolution

Use PostgreSQL for transactional state.

Add indexes based on real query plans.

Introduce partitioning only for high-volume append-only tables such as event/audit records when metrics demonstrate the need.

## 13. Observability

Use structured logs and traces.

Track:

- collaboration connection counts
- document update latency
- workflow run success/failure
- AI tool calls
- approval wait times
- database latency
- queue latency

Create product-level health dashboards separately from infrastructure metrics.

## 14. Security

V3 expands the attack surface significantly.

Required:

- RBAC/ACL tests
- canvas scene sanitisation tests (forbidden element types, unsafe links, size limits)
- CSRF protection
- OAuth state/PKCE where applicable
- secret rotation
- rate limiting
- abuse detection
- audit logs for sensitive actions
- secure session/device management
- tenant isolation tests

## 15. Data export and deletion

Users must be able to:

- export their workspace (canvases included, as Excalidraw files)
- delete selected data
- request full account deletion

The deletion process must define what happens to shared content and audit records.
