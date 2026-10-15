# V3 Implementation Plan — Canvas, Collaboration, Automation, and Scale

## 1. Build order

```text
Canvas with AI Diagrams
  -> Journal (daily notes)
  -> Templates
  -> Permissions
  -> Collaboration
  -> Comments/Mentions
  -> Domain Events
  -> Automation Engine
  -> AI Agent Runtime
  -> Memory Controls
  -> Account/Device Center
  -> Scale/Observability
```

## 2. Phase 1 — canvas with AI diagrams

Built first (owner, 2026-10-13). The full breakdown is [features/01-canvas-with-ai-diagrams.md](features/01-canvas-with-ai-diagrams.md). It needs only V1, the AI pipeline and V2 feature 11's audit log, so it does not wait for permissions or collaboration.

Slices (each ships on its own):

- **A:** canvas table, CRUD actions, Canvases sidebar tab, list page, canvas page with autosave, Trash, search, cards, task links, Outline, export.
- **B:** `DiagramSpec`, layout, scene builder, `GENERATE_DIAGRAM` route, Draw with AI dialog and preview, audit.
- **C:** `REFINE_DIAGRAM`, Additions frame, Arrange again. Wait until the owner has tried B.
- **D:** sticky boards (a second canvas kind: status columns and sticky notes that are tasks of their own kind, shown in Today). Needs A and its own migration on `tasks`; it does not use Excalidraw. Breakdown: feature 01 §13.

Definition of done:

- ADR 0017 is written before building
- a person can create, draw in, archive, trash and restore a canvas; no one else can reach it
- Draw with AI saves nothing before the person confirms, and applies once per proposal
- the canvas still works with AI off

## 2A. Phase 1B — journal and templates

Built right after the canvas (owner, 2026-10-13); they need only V1 and the notes that exist. Breakdowns: [features/02-journal-daily-notes.md](features/02-journal-daily-notes.md) and [features/03-templates.md](features/03-templates.md).

- **Journal:** a dated note per day in the note editor, the Done on this day section, the add button with the date and day as title, a folding sidebar section.
- **Templates:** their own table and tab, placeholders, New note from template, the journal template link.

Definition of done: one entry per day under concurrency; entries stay out of the Notes list and tree; templates never reach search or AI; both work at 360 px.

The breakdown of every later phase is in [features/README.md](features/README.md) (features 04 to 13); those docs win where they are more detailed.

## 3. Phase 2 — permissions

Implement:

- workspace roles
- project membership
- note sharing
- authorization policies
- ACL test suite

Definition of done:

- every read/write path has server-side permission checks
- users cannot access shared/private content outside their role

## 4. Phase 3 — collaboration

- real-time document transport
- presence
- persistence/snapshots
- reconnect
- collaborative editor tests

## 5. Phase 4 — comments

- threads
- mentions
- resolve/reopen
- notification hooks

## 6. Phase 5 — event/outbox

Introduce domain events and an outbox table.

Definition of done:

- important mutations produce durable events
- consumers can retry without duplicating side effects

## 7. Phase 6 — automation

Build:

- workflow model
- triggers
- conditions
- actions
- run logs
- approvals

Start with a very small set of triggers/actions.

## 8. Phase 7 — agent runtime

Build:

- tool registry
- risk classes
- approvals
- audit log
- execution timeline

Definition of done:

- agent actions are inspectable
- high-risk actions cannot bypass approval

## 9. Phase 8 — memory controls

Implement:

- explicit memories
- provenance
- edit/forget
- settings
- source links

## 10. Phase 9 — device/account center

- session list
- device list
- sign out other devices
- push device management

## 11. Phase 10 — scale and reliability

- load tests
- tracing
- queue tuning
- websocket reconnect testing
- backup/restore drill
- image scanning
- infrastructure documentation

## 12. V3 definition of done

Product:

- a person can draw on a canvas and have AI draw a reviewed, connected diagram
- collaboration works reliably
- permissions are understandable
- automation can execute useful repetitive workflows
- AI can orchestrate approved multi-step work
- memory is user-controlled

Engineering:

- critical paths are observable
- deployments are repeatable
- rollback is tested
- security boundaries have automated tests
- infrastructure changes are documented
