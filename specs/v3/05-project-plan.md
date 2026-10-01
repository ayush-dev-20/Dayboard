# V3 Implementation Plan — Collaboration, Automation, Integrations, and Scale

## 1. Build order

```text
Permissions
  -> Collaboration
  -> Comments/Mentions
  -> Domain Events
  -> Automation Engine
  -> Integrations Framework
  -> Webhooks
  -> AI Agent Runtime
  -> Memory Controls
  -> Account/Device Center
  -> Scale/Observability
```

## 2. Phase 1 — permissions

Implement:

- workspace roles
- project membership
- note sharing
- authorization policies
- ACL test suite

Definition of done:

- every read/write path has server-side permission checks
- users cannot access shared/private content outside their role

## 3. Phase 2 — collaboration

- real-time document transport
- presence
- persistence/snapshots
- reconnect
- collaborative editor tests

## 4. Phase 3 — comments

- threads
- mentions
- resolve/reopen
- notification hooks

## 5. Phase 4 — event/outbox

Introduce domain events and an outbox table.

Definition of done:

- important mutations produce durable events
- consumers can retry without duplicating side effects

## 6. Phase 5 — automation

Build:

- workflow model
- triggers
- conditions
- actions
- run logs
- approvals

Start with a very small set of triggers/actions.

## 7. Phase 6 — integrations

Implement one provider at a time.

Suggested order:

1. GitHub
2. Slack
3. Email provider
4. Generic webhook

Keep the integration framework provider-neutral.

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
- integration management

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

- collaboration works reliably
- permissions are understandable
- automation can execute useful repetitive workflows
- integrations connect to the core model
- AI can orchestrate approved multi-step work
- memory is user-controlled

Engineering:

- critical paths are observable
- deployments are repeatable
- rollback is tested
- security boundaries have automated tests
- infrastructure changes are documented
