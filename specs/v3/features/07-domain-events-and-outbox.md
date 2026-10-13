# Feature 07 — Domain Events & Outbox (V3)

> **Build position: seventh V3 feature** (V3 plan phase 5). It is the base for automations (08) and for several later consumers. It depends on the **background worker, V2 feature 08**, which is not built yet. Behaviour is in V3 technical spec §5; there is no product-spec section because nothing here is visible to a person. Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

- A closed **catalogue of domain events** with a Zod payload schema each: "a task was completed", "a note was created".
- An **append-only event log** written in the **same database transaction** as the change that caused it (the outbox pattern), so an event exists if and only if the change committed.
- **Dispatch to consumers** with retries, back-off, dead-lettering and idempotent handling.
- **Correlation and causation ids**, and a **loop guard**.
- Retention, a small diagnostics view, and the first consumers (a test consumer, and the hook feature 08 uses).

Reuses: V2 feature 08's `jobs`, worker, scheduler and tick mode; `runAction` and the mutation layer; feature 04's access model (for who an event belongs to); the logger and correlation ids.

Packages: none.

Source spec sections: V3 technical spec §5, §6 and §13, `../Agent.md` §7 and §10, project plan phase 5.

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | Tables, catalogue, `emit` inside transactions, the first events, the transaction test | Events appear in the log |
| **B** | Dispatcher, deliveries, retries, consumer registry, a test consumer | Consumers get each event at least once, and act once |
| **C** | Loop guard, retention job, diagnostics, metrics | Safe to leave running |

---

## 2. Data model

### `domain_events` (new, append-only)

| Column | Type | Notes |
|---|---|---|
| `seq` | bigserial PK | the global order of insertion; consumers use it only to page, never to assume order across entities |
| `id` | uuid unique | UUID v7, the event id used for idempotency |
| `type` | text | from the catalogue, e.g. `task.completed` |
| `schema_version` | smallint | version of the payload schema for `type` |
| `occurred_at` | timestamptz | |
| `owner_id` | uuid FK → user, cascade | whose workspace the entity belongs to |
| `actor_id` | uuid NULL | who did it (the owner, a collaborator, `NULL` for the system); with feature 04 these can differ |
| `source` | text | `USER`, `AUTOMATION:{id}`, `AGENT:{runId}`, `SYSTEM`, `SYNC` |
| `entity_type`, `entity_id` | text, uuid | |
| `payload` | jsonb | **ids and small facts only** (§3), validated against the catalogue |
| `correlation_id` | uuid | the request, job or run that caused it |
| `causation_id` | uuid NULL | the event that caused this one (automations), for chain tracing |
| `depth` | smallint | 0 for a person's action; +1 per automation/agent hop (§6) |

Rules: no `UPDATE` and no `DELETE` from application code (a trigger rejects them; only the retention job, using a dedicated function, deletes). Indexes: `(seq)`, `(owner_id, type, occurred_at DESC)`, `(entity_type, entity_id, seq)`.

### `event_deliveries` (new)

| Column | Notes |
|---|---|
| `event_id` | uuid FK → domain_events.id, cascade |
| `consumer` | text: a registered consumer name, e.g. `automation.match` |
| `status` | `PENDING`, `RUNNING`, `DONE`, `FAILED`, `DEAD`, `SKIPPED` |
| `attempts`, `next_attempt_at`, `last_error_code` (a code, never text from the payload), `done_at` | |

Primary key `(event_id, consumer)` is the idempotency guarantee: a delivery row exists once. Index `(status, next_attempt_at)`.

No `outbox` table separate from the log: the event row **is** the outbox record, and deliveries are fanned out from it.

---

## 3. The catalogue

`src/modules/events/catalogue.ts` is a map `type → { schemaVersion, payload: ZodSchema, entity: EntityType }`. **Adding an event type means adding its schema there**; `emit` refuses an unknown type or a payload that fails its schema (unknown keys are rejected, not stripped).

First catalogue (from the technical spec, trimmed to what feature 08 and the product need):

| Event | Entity | Payload (ids and facts) |
|---|---|---|
| `task.created` | task | `projectId?`, `dueDate?`, `priority`, `hasParent` |
| `task.completed` | task | `projectId?`, `priority`, `completedAt`, `recurring` |
| `task.reopened` | task | `projectId?` |
| `task.status_changed` | task | `from`, `to`, `projectId?` |
| `task.due_changed` | task | `from?`, `to?`, `projectId?` |
| `todo.completed` | todo | `projectId?`, `completedAt` |
| `note.created` | note | `projectId?`, `parentNoteId?`, `fromTemplateId?` |
| `note.updated` | note | `projectId?` (coalesced, below) |
| `project.created`, `project.shared` | project | `role?` (for shared) |
| `comment.created` | comment | `threadId`, `targetType`, `targetId`, `mentions: uuid[]` |
| `journal.entry_created` | note | `journalDate` |
| `calendar.connected` | account | `provider` (when V2 feature 12 exists) |
| `automation.triggered` | automation | `automationId`, `runId` |

**Payloads never hold titles, text, comment bodies or file names.** Consumers load what they need by id, through the access check, at the time they run. This keeps private content out of the log and keeps a revoked person from receiving data through an old event.

**Coalescing:** `note.updated` is not emitted per keystroke or per save. At most one pending `note.updated` exists per note: a new save within 5 minutes of the last event updates nothing and emits nothing; the first save after a quiet 5 minutes emits one. (Implemented in the emit helper with the note's last-event timestamp kept in the same transaction.)

---

## 4. Emitting (the outbox)

```ts
await db.transaction(async (tx) => {
  const task = await mutations.completeTask(tx, userId, id);   // the change
  await emit(tx, { type: "task.completed", entity: { type: "task", id }, ownerId, actorId, payload: {...} });
});
```

- `emit(tx, event)` requires a transaction handle; calling it with the bare client is a type error. It validates against the catalogue, takes the `correlation_id` from the request context (`AsyncLocalStorage`), and inserts the event.
- The existing mutation functions (`src/db/mutations/*`) take a database handle today. Wrapping the listed ones in `db.transaction` and passing the handle is the main work. It is done **per mutation, not by rewriting the layer**; unlisted mutations are untouched.
- A registry `MUTATION_EVENTS` maps each mutation to the events it must emit. A test calls each mutation and asserts **exactly those events** exist afterwards, and that a thrown error rolls both back.
- Mutations that run inside offline sync (V2 feature 05, when built) emit the same events with `source: "SYNC"` so the log has no duplicates for retried operations (the operation id is the idempotency key).

---

## 5. Dispatch and consumers

- **Consumer registry** `src/modules/events/consumers.ts`: `{ name, types: EventType[], handle(event, ctx): Promise<void>, maxAttempts }`. A consumer receives an event **at least once** and must be idempotent. Handlers get a context with the event, a logger carrying the correlation id, and an `idempotencyKey = event.id + ":" + consumer`.
- **Fan-out:** a job `events.dispatch` (every 5 s on the scheduler, and kicked at the end of a request through the tick endpoint on serverless hosts) reads events with no deliveries after the last handled `seq`, inserts one `PENDING` delivery per subscribed consumer (`ON CONFLICT DO NOTHING`), and a job `events.deliver` claims due deliveries with `FOR UPDATE SKIP LOCKED` and runs the handler.
- **Retry:** back-off 1 min, 5 min, 30 min, 2 h, 6 h, then `DEAD` (5 attempts, per consumer, configurable). A handler throws a typed `RetryableError` or `PermanentError`; a permanent one goes straight to `DEAD`. `last_error_code` holds a code, never the payload.
- **Ordering:** deliveries for the same entity are processed in `seq` order (a consumer is not given event N+1 for an entity while N is `PENDING` or retrying); there is no ordering across entities.
- **Isolation:** one consumer failing never blocks another or the web request that caused the event (the request has already committed).
- **Skip:** a consumer may mark a delivery `SKIPPED` (the entity is gone, or access was revoked) with a reason code.

---

## 6. Correlation, causation and the loop guard

- Every request, job, automation run, agent run and collaboration session has a **correlation id** (`../Agent.md` §10). It is set on the event and on every log line written while handling it.
- An event caused by an automation or agent carries `causation_id` (the event that triggered it), `source = AUTOMATION:{id}` or `AGENT:{runId}`, and `depth = parent.depth + 1`.
- **Loop guard:** `emit` refuses (and logs a counted warning without content) an event with `depth > 3`. A consumer in feature 08 additionally never reacts to events whose `source` is its own automation.

---

## 7. Retention and operations

- Job `events.prune` daily: delete events older than **90 days** and their deliveries; delete `DONE`/`SKIPPED` deliveries older than 30 days. Configurable (`EVENT_RETENTION_DAYS`). `DEAD` deliveries are kept for 30 days for inspection. The table is **not partitioned** until the metrics show a need (technical spec §12).
- **Diagnostics** (operator view, feature 13's admin page; until then a script `pnpm events:status`): counts by status per consumer, oldest pending age, dead count, dispatch lag. A person's own failed work is shown through the feature that owns it (automation run history), never as raw events.
- **Metrics** (feature 13): events emitted per type, dispatch lag, delivery latency, retries, dead letters, loop-guard hits.
- **Account deletion** removes a person's events (cascade); `actor_id` is nulled on events owned by others.
- **Replay:** an operator script can re-queue a `DEAD` delivery (`pnpm events:retry <event> <consumer>`). Replaying never emits new events.

---

## 8. Rules

- **An event exists if and only if its change committed.** Never emit outside the transaction; never emit "optimistically".
- **Events carry ids, not content.** Consumers re-check access when they run.
- **At-least-once delivery, idempotent handlers.** Every consumer states how it is idempotent in its tests.
- **Append-only.** No code path edits an event.
- **The catalogue is closed.** No dynamic event types; no payload keys without a schema.
- **Do not turn the app into event-sourcing.** Rows stay the source of truth; events are notifications of change.
- **No content in logs, metrics or errors.**

---

## 9. Environment

`EVENT_RETENTION_DAYS` (default 90), `EVENT_MAX_ATTEMPTS` (default 5), `EVENT_DISPATCH_INTERVAL_SECONDS` (default 5). The worker and `JOBS_TICK_SECRET` come from V2 feature 08.

---

## 10. Tests

**Unit**: catalogue validation (unknown type, extra key, wrong type refused); back-off schedule; ordering rule for one entity; coalescing of `note.updated`; the loop guard at depth 3 and 4; payloads contain no string fields outside an allow-list (a lint-style test over the catalogue).

**Integration** (real database)
- Each listed mutation emits exactly its events; a failing transaction (thrown after the change, or after the emit) leaves neither the change nor the event.
- The log cannot be updated or deleted by the application role (the trigger raises); the prune function can delete.
- Dispatch: one delivery row per consumer per event even with two dispatchers racing; a consumer that throws a retryable error is retried on schedule and then dead; a permanent error goes straight to dead; another consumer is unaffected.
- Idempotency: the same event delivered twice produces one effect in the test consumer.
- Ordering per entity under concurrency; access revoked between event and delivery gives `SKIPPED`.
- Correlation: the id on the request appears on the event and in the log lines; an automation-caused event carries `causation_id`, `source` and `depth`.
- Retention removes only what it should.

**E2E**: complete a task in the UI and see one `task.completed` event for it in the log (test-only read endpoint, disabled in production); repeat quickly: one event per completion.

---

## 11. Definition of done

- [ ] V2 feature 08 (worker) is built, or tick mode is available on the target host
- [ ] ADR 0020 written before building: events as the outbox, deliveries table, at-least-once with idempotent consumers, the closed catalogue, retention
- [ ] The catalogue's events are emitted from the real mutations inside their transactions, proven by the mutation registry test
- [ ] Consumers receive each event at least once and act once; retries, back-off and dead-lettering work
- [ ] No event payload holds titles, text or other private content
- [ ] The loop guard and correlation/causation ids work and are tested
- [ ] Retention and the status script work
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/domain-events-and-outbox_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 12. Out of scope (this feature)

- An external message bus or queue (Kafka, RabbitMQ, SQS), webhooks, or events leaving the app.
- Event sourcing; rebuilding state from events; a public event API.
- A user-facing event viewer.
- Table partitioning (until metrics show it).
- Events for every table; only the catalogue above.
